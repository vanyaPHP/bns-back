import { Router } from 'express'
import { HARDWARE_STATUS, HARDWARE_TYPE, enumLabel, isEnumValue } from '../lib/enums.js'
import type { Hardware } from '../lib/types.js'
import { findById, insert, newId, nowISO, readTable, update } from '../db/tables.js'
import { audit, diff } from '../domain/audit.js'
import { requireAuth, requirePermission } from '../domain/auth.js'
import { enrichHardware, parseHardwareFields } from '../domain/hardware.js'
import { loadRefs, managedDepartmentIds } from '../domain/org.js'
import { badRequest, body, forbidden, notFound, param, query, str } from '../http.js'

export const hardwareRouter = Router()

hardwareRouter.get('/', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'it.hardware.view', 'it.hardware.manage')
  const rows = await readTable('hardware')
  rows.sort((a, b) => a.inventoryNumber.localeCompare(b.inventoryNumber))
  res.json(await enrichHardware(rows))
})

hardwareRouter.post('/', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'it.hardware.manage')
  const b = body(req)
  const fields = parseHardwareFields(b)
  const employeeId = str(b.employeeId, 'Сотрудник') || null
  if (employeeId && !(await findById('employees', employeeId))) throw badRequest('Сотрудник не найден')
  const existing = await readTable('hardware')
  if (existing.some((r) => r.inventoryNumber.toLowerCase() === fields.inventoryNumber.toLowerCase())) {
    throw badRequest('Оборудование с таким инвентарным номером уже существует')
  }
  const now = nowISO()
  const hw = await insert('hardware', {
    id: newId(),
    ...fields,
    status: employeeId ? 'assigned' : fields.status === 'assigned' ? 'in_stock' : fields.status,
    employeeId,
    assignedAt: employeeId ? now : null,
    createdAt: now,
    updatedAt: now,
  })
  await audit({
    app: 'it',
    action: 'hardware.create',
    entityType: 'hardware',
    entityId: hw.id,
    userId: ctx.user.id,
    summary: `Добавлено оборудование ${hw.inventoryNumber}: ${enumLabel(HARDWARE_TYPE, hw.type)} ${hw.manufacturer} ${hw.model}`,
  })
  res.status(201).json(hw)
})

hardwareRouter.patch('/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'it.hardware.manage')
  const b = body(req)
  const current = await findById('hardware', id)
  if (!current) throw notFound('Оборудование не найдено')
  const { refs, employees } = await loadRefs()
  const now = nowISO()
  let summary = ''
  let patch: Partial<Hardware>

  switch (b.action) {
    case 'assign': {
      const employeeId = str(b.employeeId, 'Сотрудник', { required: true })
      const emp = employees.find((e) => e.id === employeeId)
      if (!emp || emp.status === 'dismissed') throw badRequest('Сотрудник не найден или уволен')
      if (current.status === 'written_off') throw badRequest('Списанное оборудование нельзя выдать')
      patch = { employeeId, status: 'assigned', assignedAt: now }
      summary = `${current.inventoryNumber} выдано сотруднику ${refs.get(employeeId)?.shortName}`
      break
    }
    case 'unassign': {
      const prev = current.employeeId
      if (!prev) throw badRequest('Оборудование не закреплено за сотрудником')
      const status = b.status ?? 'in_stock'
      if (!isEnumValue(HARDWARE_STATUS, status) || status === 'assigned') throw badRequest('Некорректный статус')
      patch = { employeeId: null, assignedAt: null, status }
      summary = `${current.inventoryNumber} изъято у сотрудника ${refs.get(prev)?.shortName} (${enumLabel(HARDWARE_STATUS, status)})`
      break
    }
    case 'update': {
      const fields = parseHardwareFields(b)
      const rows = await readTable('hardware')
      if (rows.some((r) => r.id !== id && r.inventoryNumber.toLowerCase() === fields.inventoryNumber.toLowerCase())) {
        throw badRequest('Оборудование с таким инвентарным номером уже существует')
      }
      // Assignment is managed by assign/unassign only.
      patch = { ...fields, status: current.employeeId ? 'assigned' : fields.status === 'assigned' ? 'in_stock' : fields.status }
      summary = `Изменены сведения об оборудовании ${fields.inventoryNumber}`
      break
    }
    default:
      throw badRequest('Неизвестное действие')
  }

  const updated = await update('hardware', id, { ...patch, updatedAt: now })
  await audit({
    app: 'it',
    action: `hardware.${b.action}`,
    entityType: 'hardware',
    entityId: id,
    userId: ctx.user.id,
    summary,
    changes: diff(current, updated),
  })
  res.json(updated)
})

/** Hardware assigned to the current user, or to an employee the user manages or administers. */
export const myHardwareRouter = Router()

myHardwareRouter.get('/', async (req, res) => {
  const ctx = await requireAuth(req)
  const employeeId = query(req, 'employeeId') ?? ctx.employee.id
  if (employeeId !== ctx.employee.id) {
    const [emp, departments] = await Promise.all([findById('employees', employeeId), readTable('departments')])
    const managed = managedDepartmentIds(departments, ctx.employee.id)
    const allowed = ctx.permissions.has('it.hardware.view') || ctx.permissions.has('hr.employees.view') || (emp && managed.has(emp.departmentId))
    if (!allowed) throw forbidden()
  }
  const rows = (await readTable('hardware')).filter((h) => h.employeeId === employeeId)
  res.json(await enrichHardware(rows))
})
