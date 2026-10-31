import { Router } from 'express'
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS, enumLabel, isEnumValue } from '../lib/enums.js'
import { ticketCode } from '../lib/format.js'
import type { Ticket, TicketAction } from '../lib/types.js'
import { findById, insert, newId, nextNumber, nowISO, readTable, transaction, update } from '../db/tables.js'
import { audit } from '../domain/audit.js'
import { requireAuth, requirePermission } from '../domain/auth.js'
import { loadRefs, managedDepartmentIds } from '../domain/org.js'
import { allowedActions, engineerIds, enrichTickets, loadTicketView, myTicketFilter } from '../domain/tickets.js'
import { badRequest, body, forbidden, notFound, param, query, str } from '../http.js'

const router = Router()

router.get('/', async (req, res) => {
  const ctx = await requireAuth(req)
  const scope = query(req, 'scope') ?? 'my'
  let tickets = await readTable('tickets')
  if (scope === 'all') {
    requirePermission(ctx, 'it.tickets.view')
  } else {
    const filter = await myTicketFilter(ctx)
    tickets = tickets.filter(filter)
  }
  tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json(await enrichTickets(tickets))
})

router.post('/', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'portal.tickets.create')
  const b = body(req)
  const title = str(b.title, 'Тема', { required: true, max: 200 })
  const description = str(b.description, 'Описание проблемы', { required: true, max: 5000 })
  if (!isEnumValue(TICKET_CATEGORY, b.category)) throw badRequest('Выберите категорию')
  if (!isEnumValue(TICKET_PRIORITY, b.priority)) throw badRequest('Выберите приоритет')
  const category = b.category
  const priority = b.priority

  const requesterId = str(b.requesterEmployeeId, 'Сотрудник') || ctx.employee.id
  const requester = await findById('employees', requesterId)
  if (!requester) throw badRequest('Сотрудник не найден')
  if (requester.id !== ctx.employee.id) {
    // Department heads may file tickets on behalf of employees of their (sub)departments.
    const managed = managedDepartmentIds(await readTable('departments'), ctx.employee.id)
    if (!managed.has(requester.departmentId)) throw forbidden('Можно создавать заявки только для сотрудников своего подразделения')
  }
  const hardwareId = str(b.hardwareId, 'Оборудование') || null
  if (hardwareId) {
    const hw = await findById('hardware', hardwareId)
    if (!hw || hw.employeeId !== requester.id) throw badRequest('Оборудование не закреплено за выбранным сотрудником')
  }

  const now = nowISO()
  const ticket = await transaction(async (client) => {
    const t = await insert(
      'tickets',
      {
        id: newId(),
        number: await nextNumber(client, 'tickets'),
        title,
        description,
        category,
        priority,
        status: 'new',
        requesterEmployeeId: requester.id,
        createdByUserId: ctx.user.id,
        departmentId: requester.departmentId,
        hardwareId,
        assigneeEmployeeId: null,
        resolution: '',
        resolvedAt: null,
        closedAt: null,
        verifiedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      client,
    )
    await insert('ticket_comments', { id: newId(), ticketId: t.id, userId: ctx.user.id, text: 'Заявка создана', kind: 'system', createdAt: now }, client)
    await audit(
      {
        app: 'it',
        action: 'ticket.create',
        entityType: 'ticket',
        entityId: t.id,
        userId: ctx.user.id,
        summary: `Создана заявка ${ticketCode(t.number)}: ${title}`,
      },
      client,
    )
    return t
  })
  const [dto] = await enrichTickets([ticket])
  res.status(201).json(dto)
})

router.get('/:id', async (req, res) => {
  const ctx = await requireAuth(req)
  res.json(await loadTicketView(ctx, param(req, 'id')))
})

router.patch('/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  const b = body(req)
  const action = b.action as TicketAction
  const ticket = await findById('tickets', id)
  if (!ticket) throw notFound('Заявка не найдена')
  const purchases = await readTable('purchase_requests')
  if (!allowedActions(ctx, ticket, purchases).includes(action) || action === 'comment' || action === 'request_purchase') {
    throw forbidden('Действие недоступно для текущего статуса заявки или ваших прав')
  }

  const patch: Partial<Ticket> = {}
  let note = ''
  const { refs } = await loadRefs()
  switch (action) {
    case 'take':
      patch.assigneeEmployeeId = ctx.employee.id
      patch.status = 'in_progress'
      note = `Заявку взял в работу: ${refs.get(ctx.employee.id)?.shortName}`
      break
    case 'assign': {
      const assignee = str(b.assigneeEmployeeId, 'Исполнитель', { required: true })
      if (!(await engineerIds()).has(assignee)) throw badRequest('Выбранный сотрудник не является инженером ИТ-поддержки')
      patch.assigneeEmployeeId = assignee
      if (ticket.status === 'new') patch.status = 'in_progress'
      note = `Назначен исполнитель: ${refs.get(assignee)?.shortName}`
      break
    }
    case 'set_priority':
      if (!isEnumValue(TICKET_PRIORITY, b.priority)) throw badRequest('Некорректный приоритет')
      patch.priority = b.priority
      note = `Приоритет изменён: ${enumLabel(TICKET_PRIORITY, ticket.priority)} → ${enumLabel(TICKET_PRIORITY, b.priority)}`
      break
    case 'resolve':
      patch.resolution = str(b.resolution, 'Описание решения', { required: true, max: 5000 })
      patch.status = 'resolved'
      patch.resolvedAt = nowISO()
      note = 'Работы выполнены, заявка передана на проверку руководителю ИТ-поддержки'
      break
    case 'resume':
      patch.status = 'in_progress'
      note = 'Работы по заявке возобновлены'
      break
    case 'verify':
      patch.status = 'closed'
      patch.closedAt = nowISO()
      patch.verifiedByUserId = ctx.user.id
      note = 'Выполнение подтверждено, заявка закрыта'
      break
    case 'return':
      patch.status = 'in_progress'
      patch.resolvedAt = null
      note = `Возвращена на доработку: ${str(b.comment, 'Комментарий', { required: true, max: 2000 })}`
      break
    case 'cancel':
      patch.status = 'cancelled'
      patch.closedAt = nowISO()
      note = `Заявка отменена${b.comment ? `: ${str(b.comment, 'Комментарий', { max: 2000 })}` : ''}`
      break
  }

  await transaction(async (client) => {
    // Re-check under a row lock so two users cannot apply conflicting transitions.
    await client.query('SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE', [id])
    const fresh = await findById('tickets', id, client)
    if (!fresh || fresh.status !== ticket.status || fresh.assigneeEmployeeId !== ticket.assigneeEmployeeId) {
      throw badRequest('Заявка была изменена другим пользователем. Обновите страницу')
    }
    const updated = await update('tickets', id, { ...patch, updatedAt: nowISO() }, client)
    await insert('ticket_comments', { id: newId(), ticketId: id, userId: ctx.user.id, text: note, kind: 'system', createdAt: nowISO() }, client)
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of Object.keys(patch) as (keyof Ticket)[]) {
      if (k === 'status') changes[k] = { from: enumLabel(TICKET_STATUS, ticket.status), to: enumLabel(TICKET_STATUS, updated.status) }
      else if (k === 'assigneeEmployeeId')
        changes[k] = { from: ticket.assigneeEmployeeId ? refs.get(ticket.assigneeEmployeeId)?.shortName : null, to: refs.get(updated.assigneeEmployeeId!)?.shortName }
      else changes[k] = { from: ticket[k], to: updated[k] }
    }
    await audit(
      {
        app: 'it',
        action: `ticket.${action}`,
        entityType: 'ticket',
        entityId: id,
        userId: ctx.user.id,
        summary: `${ticketCode(ticket.number)}: ${note}`,
        changes,
      },
      client,
    )
  })
  res.json(await loadTicketView(ctx, id))
})

router.post('/:id/comments', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  const ticket = await findById('tickets', id)
  if (!ticket) throw notFound('Заявка не найдена')
  const purchases = await readTable('purchase_requests')
  if (!allowedActions(ctx, ticket, purchases).includes('comment')) throw forbidden('Нельзя комментировать эту заявку')
  const text = str(body(req).text, 'Комментарий', { required: true, max: 5000 })
  const comment = await insert('ticket_comments', { id: newId(), ticketId: id, userId: ctx.user.id, text, kind: 'comment', createdAt: nowISO() })
  await audit({
    app: 'it',
    action: 'ticket.comment',
    entityType: 'ticket',
    entityId: id,
    userId: ctx.user.id,
    summary: `${ticketCode(ticket.number)}: добавлен комментарий`,
  })
  res.status(201).json(comment)
})

export default router
