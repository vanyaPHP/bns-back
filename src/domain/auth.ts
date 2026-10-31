import type { Request, Response } from 'express'
import type { ClientSession, Department, Employee, Role, User } from '../lib/types.js'
import { fullName, shortName } from '../lib/format.js'
import { pool } from '../db/pool.js'
import { findById, insert, newId, nowISO, readTable } from '../db/tables.js'
import { HttpError, forbidden } from '../http.js'

export const SESSION_COOKIE = 'bns_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12

export interface AuthContext {
  user: User
  employee: Employee
  department: Department | undefined
  roles: Role[]
  permissions: Set<string>
  headOfDepartmentIds: string[]
  isApprover: boolean
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
})

export async function createSession(res: Response, userId: string) {
  const id = newId() + newId().replace(/-/g, '')
  const now = Date.now()
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()')
  await insert('sessions', { id, userId, createdAt: nowISO(), expiresAt: new Date(now + SESSION_TTL_MS).toISOString() })
  res.cookie(SESSION_COOKIE, id, { ...cookieOptions(), maxAge: SESSION_TTL_MS })
}

export async function destroySession(req: Request, res: Response) {
  const id = req.cookies?.[SESSION_COOKIE]
  if (typeof id === 'string') await pool.query('DELETE FROM sessions WHERE id = $1', [id])
  res.clearCookie(SESSION_COOKIE, cookieOptions())
}

export async function buildAuthContext(user: User): Promise<AuthContext | null> {
  const [employee, roles, departments] = await Promise.all([findById('employees', user.employeeId), readTable('roles'), readTable('departments')])
  if (!employee) return null
  const userRoles = roles.filter((r) => user.roleIds.includes(r.id))
  const permissions = new Set(userRoles.flatMap((r) => r.permissions))
  const headOfDepartmentIds = departments.filter((d) => d.headEmployeeId === employee.id).map((d) => d.id)
  const managesSomeone =
    headOfDepartmentIds.length > 0 || (await pool.query('SELECT 1 FROM employees WHERE hr_manager_id = $1 LIMIT 1', [employee.id])).rowCount! > 0
  return {
    user,
    employee,
    department: departments.find((d) => d.id === employee.departmentId),
    roles: userRoles,
    permissions,
    headOfDepartmentIds,
    isApprover: managesSomeone,
  }
}

const authCache = new WeakMap<Request, Promise<AuthContext | null>>()

async function loadAuth(req: Request): Promise<AuthContext | null> {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (typeof sid !== 'string' || !sid) return null
  const result = await pool.query('SELECT user_id FROM sessions WHERE id = $1 AND expires_at > NOW()', [sid])
  if (!result.rows[0]) return null
  const user = await findById('users', result.rows[0].user_id)
  if (!user || !user.isActive) return null
  return buildAuthContext(user)
}

export function getAuth(req: Request): Promise<AuthContext | null> {
  let ctx = authCache.get(req)
  if (!ctx) {
    ctx = loadAuth(req)
    authCache.set(req, ctx)
  }
  return ctx
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const ctx = await getAuth(req)
  if (!ctx) throw new HttpError(401, 'Требуется авторизация')
  return ctx
}

export function requirePermission(ctx: AuthContext, ...anyOf: string[]) {
  if (!anyOf.some((p) => ctx.permissions.has(p))) throw forbidden()
}

export function toClientSession(ctx: AuthContext): ClientSession {
  return {
    userId: ctx.user.id,
    login: ctx.user.login,
    employee: {
      id: ctx.employee.id,
      fullName: fullName(ctx.employee),
      shortName: shortName(ctx.employee),
      firstName: ctx.employee.firstName,
      position: ctx.employee.position,
      departmentId: ctx.employee.departmentId,
      departmentName: ctx.department?.name ?? '',
      email: ctx.employee.email,
    },
    roles: ctx.roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    permissions: [...ctx.permissions],
    headOfDepartmentIds: ctx.headOfDepartmentIds,
    isApprover: ctx.isApprover,
  }
}
