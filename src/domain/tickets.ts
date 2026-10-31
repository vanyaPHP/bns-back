import type { PurchaseRequest, Ticket, TicketAction, TicketDTO, TicketView } from '../lib/types.js'
import { ticketCode } from '../lib/format.js'
import { findById, readTable } from '../db/tables.js'
import { forbidden, notFound } from '../http.js'
import type { AuthContext } from './auth.js'
import { loadRefs, managedDepartmentIds } from './org.js'

export async function enrichTickets(tickets: Ticket[]): Promise<TicketDTO[]> {
  const [{ refs, departments }, hardware, purchases] = await Promise.all([loadRefs(), readTable('hardware'), readTable('purchase_requests')])
  return tickets.map((t) => {
    const hw = t.hardwareId ? hardware.find((h) => h.id === t.hardwareId) : undefined
    return {
      ...t,
      code: ticketCode(t.number),
      requester: refs.get(t.requesterEmployeeId) ?? null,
      assignee: t.assigneeEmployeeId ? (refs.get(t.assigneeEmployeeId) ?? null) : null,
      departmentName: departments.find((d) => d.id === t.departmentId)?.name ?? '',
      hardware: hw ? { id: hw.id, inventoryNumber: hw.inventoryNumber, type: hw.type, manufacturer: hw.manufacturer, model: hw.model } : null,
      openPurchases: purchases.filter((p) => p.ticketId === t.id && (p.status === 'in_progress' || p.status === 'approved')).length,
    }
  })
}

/** Tickets visible on the user's "my tickets" page: own, created by them, or within departments they head. */
export async function myTicketFilter(ctx: AuthContext) {
  const departments = await readTable('departments')
  const managed = managedDepartmentIds(departments, ctx.employee.id)
  return (t: Ticket) => t.requesterEmployeeId === ctx.employee.id || t.createdByUserId === ctx.user.id || managed.has(t.departmentId)
}

export async function canViewTicket(ctx: AuthContext, t: Ticket) {
  if (ctx.permissions.has('it.tickets.view')) return true
  return (await myTicketFilter(ctx))(t)
}

export function allowedActions(ctx: AuthContext, t: Ticket, purchases: PurchaseRequest[]): TicketAction[] {
  const p = ctx.permissions
  const me = ctx.employee.id
  const isAssignee = t.assigneeEmployeeId === me
  const canWork = p.has('it.tickets.work')
  const canAssign = p.has('it.tickets.assign')
  const out: TicketAction[] = []
  const closed = t.status === 'closed' || t.status === 'cancelled'
  if (!closed) out.push('comment')
  if (canWork && !t.assigneeEmployeeId && (t.status === 'new' || t.status === 'in_progress')) out.push('take')
  if (canAssign && !closed && t.status !== 'resolved') out.push('assign')
  if (canWork && !closed) out.push('set_priority')
  const openPurchases = purchases.some((x) => x.ticketId === t.id && x.status === 'in_progress')
  if ((isAssignee || canAssign) && t.status === 'in_progress' && !openPurchases) out.push('resolve')
  if ((isAssignee || canAssign) && t.status === 'waiting_purchase' && !openPurchases) out.push('resume')
  if (p.has('it.purchases.request') && (isAssignee || canAssign) && (t.status === 'in_progress' || t.status === 'waiting_purchase')) {
    out.push('request_purchase')
  }
  if (p.has('it.tickets.verify') && t.status === 'resolved') out.push('verify', 'return')
  const isOwner = t.requesterEmployeeId === me || t.createdByUserId === ctx.user.id
  if ((isOwner && t.status === 'new') || (canAssign && !closed)) out.push('cancel')
  return out
}

export async function engineerIds(): Promise<Set<string>> {
  const [users, roles] = await Promise.all([readTable('users'), readTable('roles')])
  const engineerRoles = new Set(roles.filter((r) => r.permissions.includes('it.tickets.work')).map((r) => r.id))
  return new Set(users.filter((u) => u.isActive && u.roleIds.some((r) => engineerRoles.has(r))).map((u) => u.employeeId))
}

export async function loadTicketView(ctx: AuthContext, id: string): Promise<TicketView> {
  const ticket = await findById('tickets', id)
  if (!ticket) throw notFound('Заявка не найдена')
  if (!(await canViewTicket(ctx, ticket))) throw forbidden()
  const [comments, purchases, users, { refs }] = await Promise.all([
    readTable('ticket_comments'),
    readTable('purchase_requests'),
    readTable('users'),
    loadRefs(),
  ])
  const userRef = (userId: string | null) => {
    const u = users.find((x) => x.id === userId)
    return u ? (refs.get(u.employeeId) ?? null) : null
  }
  const [dto] = await enrichTickets([ticket])
  const ticketPurchases = purchases.filter((p) => p.ticketId === ticket.id)
  return {
    ticket: dto,
    verifiedBy: userRef(ticket.verifiedByUserId),
    comments: comments
      .filter((c) => c.ticketId === ticket.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ ...c, author: userRef(c.userId) })),
    purchases: ticketPurchases.map((p) => ({ ...p, requestedBy: userRef(p.requestedByUserId), decidedBy: userRef(p.decidedByUserId) })),
    actions: allowedActions(ctx, ticket, purchases),
  }
}
