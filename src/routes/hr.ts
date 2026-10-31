import { Readable } from 'node:stream'
import { Router } from 'express'
import { DOCUMENT_TYPE, EMPLOYEE_STATUS, enumLabel } from '../lib/enums.js'
import { fullName, todayISO } from '../lib/format.js'
import type { DocumentDTO, EmployeeDocument } from '../lib/types.js'
import { pool } from '../db/pool.js'
import { findById, insert, newId, nowISO, readTable, remove, transaction, update } from '../db/tables.js'
import { audit, diff, mask } from '../domain/audit.js'
import { requireAuth, requirePermission } from '../domain/auth.js'
import { parseDepartment, toDepartmentDTOs } from '../domain/departments.js'
import { parseEmployee, toEmployeeDTOs } from '../domain/employees.js'
import { descendantIds, loadRefs } from '../domain/org.js'
import { deleteUpload, documentUpload, readUpload, storeUpload } from '../domain/uploads.js'
import { badRequest, body, notFound, param, query, str } from '../http.js'

const router = Router()

// Departments

router.get('/departments', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.departments.view', 'hr.employees.view')
  res.json(await toDepartmentDTOs(await readTable('departments')))
})

router.post('/departments', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.departments.manage')
  const input = await parseDepartment(body(req))
  const now = nowISO()
  const dept = await insert('departments', { id: newId(), ...input, createdAt: now, updatedAt: now })
  await audit({
    app: 'hr',
    action: 'department.create',
    entityType: 'department',
    entityId: dept.id,
    userId: ctx.user.id,
    summary: `Создано подразделение «${dept.name}» (${dept.code})`,
  })
  res.status(201).json(dept)
})

router.patch('/departments/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.departments.manage')
  const current = await findById('departments', id)
  if (!current) throw notFound('Подразделение не найдено')
  const input = await parseDepartment(body(req), id)
  const updated = await update('departments', id, { ...input, updatedAt: nowISO() })
  const { refs } = await loadRefs()
  const changes = diff(current, updated)
  if (changes?.headEmployeeId) {
    changes.headEmployeeId = { from: refs.get(current.headEmployeeId)?.shortName, to: refs.get(updated.headEmployeeId)?.shortName }
  }
  await audit({
    app: 'hr',
    action: 'department.update',
    entityType: 'department',
    entityId: id,
    userId: ctx.user.id,
    summary: `Изменено подразделение «${updated.name}»`,
    changes,
  })
  res.json(updated)
})

router.delete('/departments/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.departments.manage')
  const [departments, employees] = await Promise.all([readTable('departments'), readTable('employees')])
  const dept = departments.find((d) => d.id === id)
  if (!dept) throw notFound('Подразделение не найдено')
  if (departments.some((d) => d.parentId === id)) throw badRequest('Нельзя удалить подразделение с дочерними подразделениями')
  if (employees.some((e) => e.departmentId === id)) throw badRequest('Нельзя удалить подразделение, в котором числятся сотрудники')
  await remove('departments', id)
  await audit({ app: 'hr', action: 'department.delete', entityType: 'department', entityId: id, userId: ctx.user.id, summary: `Удалено подразделение «${dept.name}»` })
  res.json({ ok: true })
})

// Employees

router.get('/employees', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.view')
  const rows = await readTable('employees')
  rows.sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'))
  res.json(await toEmployeeDTOs(rows, ctx))
})

router.post('/employees', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.create')
  const input = parseEmployee(body(req))
  if (!(await findById('departments', input.departmentId))) throw badRequest('Подразделение не найдено')
  const now = nowISO()
  const employee = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('employees'))")
    const rows = await readTable('employees', client)
    if (rows.some((r) => r.email.toLowerCase() === input.email.toLowerCase())) throw badRequest('Сотрудник с таким email уже существует')
    if (rows.some((r) => r.passport.personalNumber === input.passport.personalNumber)) {
      throw badRequest('Сотрудник с таким идентификационным номером уже зарегистрирован')
    }
    const e = await insert(
      'employees',
      {
        id: newId(),
        personnelNumber: String(rows.reduce((m, r) => Math.max(m, Number(r.personnelNumber) || 0), 1000) + 1),
        ...input,
        // The HR manager who registers the employee becomes their responsible HR manager.
        hrManagerId: ctx.employee.id,
        createdAt: now,
        updatedAt: now,
      },
      client,
    )
    await audit(
      {
        app: 'hr',
        action: 'employee.create',
        entityType: 'employee',
        entityId: e.id,
        userId: ctx.user.id,
        summary: `Принят сотрудник ${fullName(e)} (таб. № ${e.personnelNumber}), ${e.position}`,
      },
      client,
    )
    return e
  })
  const [dto] = await toEmployeeDTOs([employee], ctx)
  res.status(201).json(dto)
})

router.get('/employees/:id', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.view')
  const e = await findById('employees', param(req, 'id'))
  if (!e) throw notFound('Сотрудник не найден')
  const [dto] = await toEmployeeDTOs([e], ctx)
  res.json(dto)
})

router.patch('/employees/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.edit')
  const b = body(req)
  const current = await findById('employees', id)
  if (!current) throw notFound('Сотрудник не найден')
  if (!ctx.permissions.has('hr.employees.sensitive')) {
    // Without access to sensitive data the redacted values must not overwrite real ones.
    b.passport = current.passport
    b.bank = current.bank
  }
  const input = parseEmployee(b)
  const departments = await readTable('departments')
  if (!departments.some((d) => d.id === input.departmentId)) throw badRequest('Подразделение не найдено')
  const headOf = departments.filter((d) => d.headEmployeeId === id)
  if (headOf.length && (input.departmentId !== current.departmentId || input.status === 'dismissed')) {
    const wrong = headOf.filter((d) => d.id !== input.departmentId || input.status === 'dismissed')
    if (wrong.length) {
      throw badRequest(`Сотрудник является руководителем подразделения «${wrong[0].name}». Сначала назначьте другого руководителя`)
    }
  }
  const hrManagerId = str(b.hrManagerId, 'HR-менеджер') || current.hrManagerId
  if (hrManagerId && hrManagerId !== current.hrManagerId && !(await findById('employees', hrManagerId))) throw badRequest('HR-менеджер не найден')
  const duplicate = await pool.query('SELECT 1 FROM employees WHERE id <> $1 AND LOWER(email) = LOWER($2)', [id, input.email])
  if (duplicate.rowCount) throw badRequest('Сотрудник с таким email уже существует')

  const updated = await update('employees', id, { ...input, hrManagerId, updatedAt: nowISO() })
  const statusChanged = current.status !== updated.status
  await audit({
    app: 'hr',
    action: 'employee.update',
    entityType: 'employee',
    entityId: id,
    userId: ctx.user.id,
    summary: `Изменена карточка сотрудника ${fullName(updated)}${statusChanged ? ` (статус: ${enumLabel(EMPLOYEE_STATUS, updated.status)})` : ''}`,
    changes: mask(diff(current, updated), ['passport', 'bank']),
  })
  const [dto] = await toEmployeeDTOs([updated], ctx)
  res.json(dto)
})

// Documents

async function toDocumentDTOs(docs: EmployeeDocument[]): Promise<DocumentDTO[]> {
  const [users, { refs }] = await Promise.all([readTable('users'), loadRefs()])
  return docs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((d) => {
      const u = users.find((x) => x.id === d.uploadedByUserId)
      return { ...d, employee: refs.get(d.employeeId) ?? null, uploadedBy: u ? (refs.get(u.employeeId)?.shortName ?? u.login) : '—' }
    })
}

router.get('/employees/:id/documents', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.view')
  const docs = (await readTable('employee_documents')).filter((d) => d.employeeId === id)
  res.json(await toDocumentDTOs(docs))
})

router.post('/employees/:id/documents', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.documents.manage')
  const employee = await findById('employees', id)
  if (!employee) throw notFound('Сотрудник не найден')
  await new Promise<void>((resolve, reject) => documentUpload(req, res, (error: unknown) => (error ? reject(error) : resolve())))
  const doc = await storeUpload(req.file, body(req), id, ctx.user.id)
  try {
    await insert('employee_documents', doc)
  } catch (error) {
    await deleteUpload(doc.storedName)
    throw error
  }
  await audit({
    app: 'hr',
    action: 'document.upload',
    entityType: 'employee',
    entityId: id,
    userId: ctx.user.id,
    summary: `Загружен документ «${doc.title}» (${enumLabel(DOCUMENT_TYPE, doc.type)}) — ${fullName(employee)}`,
  })
  res.status(201).json(doc)
})

router.get('/documents', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.view')
  res.json(await toDocumentDTOs(await readTable('employee_documents')))
})

router.get('/documents/:id', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.view')
  const doc = await findById('employee_documents', param(req, 'id'))
  if (!doc) throw notFound('Документ не найден')
  const stream = await readUpload(doc.storedName)
  if (!stream) throw notFound('Файл документа отсутствует в хранилище')
  const inline = query(req, 'inline') === '1'
  // Allow the browser's built-in PDF/image viewer; the payload is served as a standalone document.
  res.removeHeader('Content-Security-Policy')
  res.set({
    'Content-Type': doc.mimeType,
    'Content-Length': String(doc.size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  Readable.fromWeb(stream as import('node:stream/web').ReadableStream).pipe(res)
})

router.delete('/documents/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.documents.manage')
  const doc = await findById('employee_documents', id)
  if (!doc) throw notFound('Документ не найден')
  await remove('employee_documents', id)
  await deleteUpload(doc.storedName)
  const { refs } = await loadRefs()
  await audit({
    app: 'hr',
    action: 'document.delete',
    entityType: 'employee',
    entityId: doc.employeeId,
    userId: ctx.user.id,
    summary: `Удалён документ «${doc.title}» (${enumLabel(DOCUMENT_TYPE, doc.type)}) — ${refs.get(doc.employeeId)?.fullName ?? ''}`,
  })
  res.json({ ok: true })
})

// Dashboard

router.get('/stats', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'hr.employees.view')
  const [employees, departments, leaves, documents] = await Promise.all([
    readTable('employees'),
    readTable('departments'),
    readTable('leave_requests'),
    pool.query('SELECT COUNT(*)::int AS count FROM employee_documents'),
  ])
  const active = employees.filter((e) => e.status !== 'dismissed')
  const today = todayISO()
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const onLeave = leaves.filter((l) => l.status === 'approved' && l.startDate <= today && l.endDate >= today)

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const birthdays = active
    .map((e) => {
      const [, m, d] = e.birthDate.split('-').map(Number)
      let next = new Date(now.getFullYear(), m - 1, d)
      if (next < startOfToday) next = new Date(now.getFullYear() + 1, m - 1, d)
      return {
        id: e.id,
        name: fullName(e),
        position: e.position,
        date: `${next.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        inDays: Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000),
      }
    })
    .filter((b) => b.inDays <= 30)
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, 6)

  // Headcount per first-level unit (including nested sub-units).
  const root = departments.find((d) => d.parentId === null)
  const units = departments.filter((d) => d.parentId === root?.id)
  const headcount = [
    ...(root ? [{ id: root.id, label: root.name, value: active.filter((e) => e.departmentId === root.id).length }] : []),
    ...units.map((d) => {
      const ids = new Set(descendantIds(departments, d.id))
      return { id: d.id, label: d.name, value: active.filter((e) => ids.has(e.departmentId)).length }
    }),
  ].sort((a, b) => b.value - a.value)

  res.json({
    total: active.length,
    probation: active.filter((e) => e.status === 'probation').length,
    dismissed: employees.length - active.length,
    newHires: active.filter((e) => e.hireDate >= monthAgo).length,
    onLeaveToday: onLeave.length,
    departments: departments.length,
    documents: documents.rows[0].count as number,
    myEmployees: active.filter((e) => e.hrManagerId === ctx.employee.id).length,
    headcount,
    birthdays,
    recentHires: [...active]
      .sort((a, b) => b.hireDate.localeCompare(a.hireDate))
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        name: fullName(e),
        position: e.position,
        hireDate: e.hireDate,
        department: departments.find((d) => d.id === e.departmentId)?.name ?? '',
      })),
  })
})

export default router
