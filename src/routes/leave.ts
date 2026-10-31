import { Router } from 'express'
import { APPROVAL_STATUS, LEAVE_STATUS, LEAVE_TYPE, enumLabel, isEnumValue } from '../lib/enums.js'
import { daysBetweenInclusive, formatDate, fullName, todayISO } from '../lib/format.js'
import type { LeaveRequest } from '../lib/types.js'
import { findById, insert, newId, nextNumber, nowISO, readTable, transaction, update } from '../db/tables.js'
import { audit } from '../domain/audit.js'
import { requireAuth, requirePermission } from '../domain/auth.js'
import { annualBalance, approverRoles, canCancel, canSeeEmployeeLeaves, overallStatus, resolveApprovers, toLeaveDTOs } from '../domain/leave.js'
import { descendantIds, loadRefs, managedDepartmentIds } from '../domain/org.js'
import { badRequest, body, forbidden, isoDate, notFound, param, query, str } from '../http.js'

const router = Router()

router.get('/', async (req, res) => {
  const ctx = await requireAuth(req)
  const scope = query(req, 'scope') ?? 'my'
  const leaves = await readTable('leave_requests')
  let rows: LeaveRequest[]
  if (scope === 'all') {
    requirePermission(ctx, 'vacation.view_all')
    rows = leaves
  } else if (scope === 'approvals') {
    rows = leaves.filter((l) => l.headApproval.approverEmployeeId === ctx.employee.id || l.hrApproval.approverEmployeeId === ctx.employee.id)
  } else if (scope === 'employee') {
    const employeeId = query(req, 'employeeId') ?? ''
    if (!(await canSeeEmployeeLeaves(ctx, employeeId))) throw forbidden()
    rows = leaves.filter((l) => l.employeeId === employeeId)
  } else {
    rows = leaves.filter((l) => l.employeeId === ctx.employee.id)
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json(await toLeaveDTOs(rows, ctx))
})

router.post('/', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'vacation.request')
  const b = body(req)
  if (!isEnumValue(LEAVE_TYPE, b.type)) throw badRequest('Выберите тип отсутствия')
  const type = b.type
  const startDate = isoDate(b.startDate, 'Дата начала')
  const endDate = isoDate(b.endDate, 'Дата окончания')
  if (endDate < startDate) throw badRequest('Дата окончания не может быть раньше даты начала')
  const today = todayISO()
  // Sick leave may be registered retroactively (within 30 days); other types only for future dates.
  const minStart = type === 'sick' ? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) : today
  if (startDate < minStart) throw badRequest(type === 'sick' ? 'Больничный можно оформить не позднее 30 дней с начала' : 'Дата начала не может быть в прошлом')
  const days = daysBetweenInclusive(startDate, endDate)
  if (days > 120) throw badRequest('Слишком длительный период')
  const reason = str(b.reason, 'Комментарий', { max: 1000, required: type === 'unpaid' })

  const employee = await findById('employees', ctx.employee.id)
  if (!employee) throw notFound()
  const { head, hr } = await resolveApprovers(employee)
  const now = nowISO()

  const leave = await transaction(async (client) => {
    // Serialise requests per employee so overlap and balance checks stay consistent.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`leave:${employee.id}`])
    const leaves = await readTable('leave_requests', client)
    const overlap = leaves.find(
      (l) => l.employeeId === employee.id && (l.status === 'pending' || l.status === 'approved') && l.startDate <= endDate && l.endDate >= startDate,
    )
    if (overlap) throw badRequest(`Период пересекается с заявлением №${overlap.number} (${formatDate(overlap.startDate)} — ${formatDate(overlap.endDate)})`)
    if (type === 'annual') {
      const balance = await annualBalance(employee.id, Number(startDate.slice(0, 4)), client)
      if (days > balance.remaining) throw badRequest(`Недостаточно дней отпуска: доступно ${balance.remaining} из ${balance.entitlement}`)
    }
    const l: LeaveRequest = {
      id: newId(),
      number: await nextNumber(client, 'leave_requests'),
      employeeId: employee.id,
      type,
      startDate,
      endDate,
      days,
      reason,
      status: 'pending',
      headApproval: head,
      hrApproval: hr,
      createdByUserId: ctx.user.id,
      createdAt: now,
      updatedAt: now,
    }
    l.status = overallStatus(l)
    const created = await insert('leave_requests', l, client)
    await audit(
      {
        app: 'vacation',
        action: 'leave.create',
        entityType: 'leave',
        entityId: created.id,
        userId: ctx.user.id,
        summary: `Заявление №${created.number}: ${enumLabel(LEAVE_TYPE, type)} ${formatDate(startDate)} — ${formatDate(endDate)} (${days} дн.), ${fullName(employee)}`,
      },
      client,
    )
    return created
  })
  const [dto] = await toLeaveDTOs([leave], ctx)
  res.status(201).json(dto)
})

router.get('/balance', async (req, res) => {
  const ctx = await requireAuth(req)
  const employeeId = query(req, 'employeeId') ?? ctx.employee.id
  if (!(await canSeeEmployeeLeaves(ctx, employeeId))) throw forbidden()
  const year = Number(query(req, 'year')) || new Date().getFullYear()
  res.json(await annualBalance(employeeId, year))
})

/** Approved and pending absences for a month, scoped to the departments the user may see. */
router.get('/calendar', async (req, res) => {
  const ctx = await requireAuth(req)
  const requestedMonth = query(req, 'month') ?? ''
  const month = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : new Date().toISOString().slice(0, 7)
  const { employees, departments, refs } = await loadRefs()

  const managed = managedDepartmentIds(departments, ctx.employee.id)
  const allowed = new Set<string>([ctx.employee.departmentId, ...managed])
  const requested = query(req, 'departmentId')
  let deptIds: Set<string>
  if (requested) {
    if (!ctx.permissions.has('vacation.view_all') && !allowed.has(requested)) throw forbidden()
    deptIds = new Set(descendantIds(departments, requested))
  } else {
    deptIds = allowed
  }

  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const people = employees.filter((e) => deptIds.has(e.departmentId) && e.status !== 'dismissed')
  const ids = new Set(people.map((p) => p.id))
  const leaves = (await readTable('leave_requests')).filter(
    (l) => ids.has(l.employeeId) && (l.status === 'approved' || l.status === 'pending') && l.startDate <= last && l.endDate >= first,
  )
  res.json({
    month,
    departments: departments.filter((d) => ctx.permissions.has('vacation.view_all') || allowed.has(d.id)).map((d) => ({ id: d.id, name: d.name })),
    employees: people.map((p) => refs.get(p.id)!).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    leaves: leaves.map((l) => ({ id: l.id, employeeId: l.employeeId, type: l.type, status: l.status, startDate: l.startDate, endDate: l.endDate })),
  })
})

router.get('/:id', async (req, res) => {
  const ctx = await requireAuth(req)
  const leave = await findById('leave_requests', param(req, 'id'))
  if (!leave) throw notFound('Заявление не найдено')
  const isApprover = leave.headApproval.approverEmployeeId === ctx.employee.id || leave.hrApproval.approverEmployeeId === ctx.employee.id
  if (!isApprover && !(await canSeeEmployeeLeaves(ctx, leave.employeeId))) throw forbidden()
  const [dto] = await toLeaveDTOs([leave], ctx)
  res.json(dto)
})

router.patch('/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  const b = body(req)
  const action = b.action
  const comment = str(b.comment, 'Комментарий', { max: 1000 })
  const { refs } = await loadRefs()

  const { current, updated, summary } = await transaction(async (client) => {
    await client.query('SELECT 1 FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
    const current = await findById('leave_requests', id, client)
    if (!current) throw notFound('Заявление не найдено')
    const l = structuredClone(current)
    const now = nowISO()
    let summary: string
    if (action === 'cancel') {
      if (!canCancel(ctx, l, todayISO())) throw forbidden('Отменить можно только своё заявление до начала отпуска')
      l.status = 'cancelled'
      summary = `Заявление №${l.number} отменено сотрудником`
    } else if (action === 'approve' || action === 'reject') {
      const roles = approverRoles(ctx, l)
      if (!roles.length) throw forbidden('Вы не являетесь согласующим по этому заявлению или уже приняли решение')
      if (action === 'reject' && !comment) throw badRequest('Укажите причину отклонения')
      const status = action === 'approve' ? 'approved' : 'rejected'
      for (const r of roles) {
        const s = r === 'head' ? l.headApproval : l.hrApproval
        s.status = status
        s.decidedAt = now
        s.comment = comment
      }
      l.status = overallStatus(l)
      const as = roles.map((r) => (r === 'head' ? 'руководитель' : 'HR-менеджер')).join(' и ')
      summary = `Заявление №${l.number} (${refs.get(l.employeeId)?.shortName}): ${as} — ${enumLabel(APPROVAL_STATUS, status).toLowerCase()}. Итог: ${enumLabel(LEAVE_STATUS, l.status)}`
    } else {
      throw badRequest('Неизвестное действие')
    }
    const updated = await update(
      'leave_requests',
      id,
      { status: l.status, headApproval: l.headApproval, hrApproval: l.hrApproval, updatedAt: now },
      client,
    )
    return { current, updated, summary }
  })

  await audit({
    app: 'vacation',
    action: `leave.${action}`,
    entityType: 'leave',
    entityId: id,
    userId: ctx.user.id,
    summary: summary + (comment ? ` — «${comment}»` : ''),
    changes: { status: { from: enumLabel(LEAVE_STATUS, current.status), to: enumLabel(LEAVE_STATUS, updated.status) } },
  })
  const [dto] = await toLeaveDTOs([updated], ctx)
  res.json(dto)
})

export default router
