import { Router } from 'express'
import { PURCHASE_STATUS, enumLabel, type PurchaseStatus } from '../lib/enums.js'
import { ticketCode } from '../lib/format.js'
import type { PurchaseItem } from '../lib/types.js'
import { findById, insert, newId, nextNumber, nowISO, readTable, transaction, update } from '../db/tables.js'
import { audit } from '../domain/audit.js'
import { requireAuth, requirePermission } from '../domain/auth.js'
import { loadRefs } from '../domain/org.js'
import { allowedActions } from '../domain/tickets.js'
import { badRequest, body, forbidden, notFound, param, str } from '../http.js'

const router = Router()

router.get('/', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'it.purchases.request', 'it.purchases.approve')
  const [purchases, tickets, users, { refs }] = await Promise.all([readTable('purchase_requests'), readTable('tickets'), readTable('users'), loadRefs()])
  const userRef = (id: string | null) => {
    const u = users.find((x) => x.id === id)
    return u ? (refs.get(u.employeeId) ?? null) : null
  }
  res.json(
    purchases
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => {
        const t = tickets.find((x) => x.id === p.ticketId)
        return {
          ...p,
          total: p.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
          ticket: t ? { id: t.id, code: ticketCode(t.number), title: t.title } : null,
          requestedBy: userRef(p.requestedByUserId),
          decidedBy: userRef(p.decidedByUserId),
        }
      }),
  )
})

router.post('/', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'it.purchases.request')
  const b = body(req)
  const ticket = await findById('tickets', str(b.ticketId, 'Заявка', { required: true }))
  if (!ticket) throw notFound('Заявка не найдена')
  const all = await readTable('purchase_requests')
  if (!allowedActions(ctx, ticket, all).includes('request_purchase')) throw forbidden('Запрос закупки по этой заявке недоступен')
  const justification = str(b.justification, 'Обоснование', { required: true, max: 2000 })
  const rawItems = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : []
  const items: PurchaseItem[] = rawItems
    .map((i) => ({ name: str(i?.name, 'Наименование', { max: 200 }), quantity: Number(i?.quantity), unitPrice: Number(i?.unitPrice) }))
    .filter((i) => i.name)
  if (!items.length) throw badRequest('Добавьте хотя бы одну позицию')
  if (items.some((i) => !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) {
    throw badRequest('Проверьте количество и цену позиций')
  }
  const now = nowISO()
  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const purchase = await transaction(async (client) => {
    const p = await insert(
      'purchase_requests',
      {
        id: newId(),
        number: await nextNumber(client, 'purchase_requests'),
        ticketId: ticket.id,
        requestedByUserId: ctx.user.id,
        items,
        justification,
        status: 'in_progress',
        decidedByUserId: null,
        decidedAt: null,
        decisionComment: '',
        createdAt: now,
        updatedAt: now,
      },
      client,
    )
    await update('tickets', ticket.id, { status: 'waiting_purchase', updatedAt: now }, client)
    await insert(
      'ticket_comments',
      {
        id: newId(),
        ticketId: ticket.id,
        userId: ctx.user.id,
        text: `Создан запрос на закупку №${p.number} на сумму ${total.toFixed(2)} BYN — ожидает согласования`,
        kind: 'system',
        createdAt: now,
      },
      client,
    )
    await audit(
      {
        app: 'it',
        action: 'purchase.create',
        entityType: 'purchase',
        entityId: p.id,
        userId: ctx.user.id,
        summary: `Запрос на закупку №${p.number} по заявке ${ticketCode(ticket.number)} (${total.toFixed(2)} BYN)`,
      },
      client,
    )
    return p
  })
  res.status(201).json(purchase)
})

router.patch('/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  const b = body(req)
  const action = b.action
  const purchase = await findById('purchase_requests', id)
  if (!purchase) throw notFound('Запрос на закупку не найден')
  const comment = str(b.comment, 'Комментарий', { max: 2000 })

  let next: PurchaseStatus
  if (action === 'approve' || action === 'reject') {
    if (!ctx.permissions.has('it.purchases.approve')) throw forbidden('Согласование закупок доступно только руководителю ИТ-поддержки')
    if (purchase.status !== 'in_progress') throw badRequest('Запрос уже рассмотрен')
    if (action === 'reject' && !comment) throw badRequest('Укажите причину отклонения')
    next = action === 'approve' ? 'approved' : 'rejected'
  } else if (action === 'deliver') {
    const allowed = ctx.permissions.has('it.purchases.approve') || purchase.requestedByUserId === ctx.user.id
    if (!allowed) throw forbidden()
    if (purchase.status !== 'approved') throw badRequest('Отметить получение можно только для одобренной закупки')
    next = 'delivered'
  } else {
    throw badRequest('Неизвестное действие')
  }

  const now = nowISO()
  const decided = action !== 'deliver'
  const updated = await transaction(async (client) => {
    // Guard against a concurrent decision on the same purchase.
    const locked = await client.query('SELECT status FROM purchase_requests WHERE id = $1 FOR UPDATE', [id])
    if (locked.rows[0]?.status !== purchase.status) throw badRequest('Запрос уже рассмотрен')
    const p = await update(
      'purchase_requests',
      id,
      decided ? { status: next, updatedAt: now, decidedByUserId: ctx.user.id, decidedAt: now, decisionComment: comment } : { status: next, updatedAt: now },
      client,
    )

    const ticket = await findById('tickets', purchase.ticketId, client)
    if (ticket && next !== 'approved') {
      // Rejected or delivered purchases unblock the ticket once nothing else is pending.
      const all = await readTable('purchase_requests', client)
      const stillOpen = all.some((x) => x.ticketId === ticket.id && x.id !== id && (x.status === 'in_progress' || x.status === 'approved'))
      if (ticket.status === 'waiting_purchase' && !stillOpen) await update('tickets', ticket.id, { status: 'in_progress', updatedAt: now }, client)
    }
    if (ticket) {
      await insert(
        'ticket_comments',
        {
          id: newId(),
          ticketId: ticket.id,
          userId: ctx.user.id,
          text: `Закупка №${purchase.number}: ${enumLabel(PURCHASE_STATUS, next)}${comment ? ` — ${comment}` : ''}`,
          kind: 'system',
          createdAt: now,
        },
        client,
      )
    }
    await audit(
      {
        app: 'it',
        action: `purchase.${action}`,
        entityType: 'purchase',
        entityId: id,
        userId: ctx.user.id,
        summary: `Закупка №${purchase.number}${ticket ? ` (${ticketCode(ticket.number)})` : ''}: ${enumLabel(PURCHASE_STATUS, next)}`,
        changes: { status: { from: enumLabel(PURCHASE_STATUS, purchase.status), to: enumLabel(PURCHASE_STATUS, next) } },
      },
      client,
    )
    return p
  })
  res.json(updated)
})

export default router
