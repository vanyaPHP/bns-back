import { Router } from 'express'
import { APP_CODES, type AppCode } from '../lib/enums.js'
import { readTable } from '../db/tables.js'
import { requireAuth } from '../domain/auth.js'
import { loadRefs } from '../domain/org.js'
import { badRequest, forbidden, query } from '../http.js'

const router = Router()

router.get('/', async (req, res) => {
  const ctx = await requireAuth(req)
  const app = query(req, 'app') as AppCode | null
  if (app && !APP_CODES.includes(app)) throw badRequest('Неизвестное приложение')
  const global = ctx.permissions.has('admin.audit.view')
  if (!global && !(app && ctx.permissions.has(`${app}.audit.view`))) throw forbidden()

  const entityId = query(req, 'entityId')
  const userId = query(req, 'userId')
  const from = query(req, 'from')
  const to = query(req, 'to')
  const q = query(req, 'q')?.toLowerCase().trim()
  const limit = Math.min(Number(query(req, 'limit')) || 1000, 5000)

  const [logs, users, { refs }] = await Promise.all([readTable('audit_logs'), readTable('users'), loadRefs()])
  const userMap = new Map(users.map((u) => [u.id, u]))
  const rows = logs
    .filter((l) => (!app || l.app === app) && (!entityId || l.entityId === entityId) && (!userId || l.userId === userId))
    .filter((l) => (!from || l.createdAt.slice(0, 10) >= from) && (!to || l.createdAt.slice(0, 10) <= to))
    .map((l) => {
      const u = l.userId ? userMap.get(l.userId) : undefined
      return { ...l, user: u ? { login: u.login, name: refs.get(u.employeeId)?.shortName ?? u.login } : null }
    })
    .filter((l) => !q || `${l.summary} ${l.action} ${l.user?.name ?? ''} ${l.user?.login ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
  res.json(rows)
})

export default router
