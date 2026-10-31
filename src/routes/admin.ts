import { Router } from 'express'
import { permissionLabel } from '../lib/permissions.js'
import type { Role, User } from '../lib/types.js'
import { pool } from '../db/pool.js'
import { findById, insert, newId, nowISO, readTable, remove, transaction, update } from '../db/tables.js'
import { audit } from '../domain/audit.js'
import { requireAuth, requirePermission } from '../domain/auth.js'
import { loadRefs } from '../domain/org.js'
import { hashPassword, validatePassword } from '../domain/password.js'
import { parseRole } from '../domain/roles.js'
import { toUserDTOs } from '../domain/users.js'
import { badRequest, body, notFound, param, str } from '../http.js'

const router = Router()

// Users

router.get('/users', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.users.view')
  const users = await readTable('users')
  users.sort((a, b) => a.login.localeCompare(b.login))
  res.json(await toUserDTOs(users))
})

router.post('/users', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.users.manage')
  const b = body(req)
  const login = str(b.login, 'Логин', { required: true, max: 50 }).toLowerCase()
  if (!/^[a-z0-9._-]{3,}$/.test(login)) throw badRequest('Логин: латинские буквы, цифры, точка, дефис; не менее 3 символов')
  const password = str(b.password, 'Пароль', { required: true, max: 100 })
  const pwError = validatePassword(password)
  if (pwError) throw badRequest(pwError)
  const employeeId = str(b.employeeId, 'Сотрудник', { required: true })
  const roleIds = Array.isArray(b.roleIds) ? b.roleIds.map(String) : []
  const [roles, employees, users] = await Promise.all([readTable('roles'), readTable('employees'), readTable('users')])
  if (!employees.some((e) => e.id === employeeId && e.status !== 'dismissed')) throw badRequest('Сотрудник не найден или уволен')
  if (roleIds.some((r) => !roles.some((x) => x.id === r))) throw badRequest('Указана несуществующая роль')
  if (!roleIds.length) throw badRequest('Назначьте хотя бы одну роль')
  if (users.some((u) => u.login === login)) throw badRequest('Логин уже занят')
  if (users.some((u) => u.employeeId === employeeId)) throw badRequest('У сотрудника уже есть учётная запись')

  const now = nowISO()
  const user = await insert('users', {
    id: newId(),
    login,
    passwordHash: hashPassword(password),
    employeeId,
    roleIds,
    isActive: true,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  })
  const { refs } = await loadRefs()
  await audit({
    app: 'admin',
    action: 'user.create',
    entityType: 'user',
    entityId: user.id,
    userId: ctx.user.id,
    summary: `Создана учётная запись ${login} для ${refs.get(employeeId)?.fullName}; роли: ${roles
      .filter((r) => roleIds.includes(r.id))
      .map((r) => r.name)
      .join(', ')}`,
  })
  const [dto] = await toUserDTOs([user])
  res.status(201).json(dto)
})

router.patch('/users/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.users.manage')
  const b = body(req)
  const current = await findById('users', id)
  if (!current) throw notFound('Пользователь не найден')
  const roles = await readTable('roles')
  const roleName = (rid: string) => roles.find((r) => r.id === rid)?.name ?? rid
  let summary = ''
  let changes: Record<string, { from: unknown; to: unknown }> | null = null
  const patch: Partial<User> = { updatedAt: nowISO() }

  if (b.action === 'reset_password') {
    const password = str(b.password, 'Пароль', { required: true, max: 100 })
    const err = validatePassword(password)
    if (err) throw badRequest(err)
    patch.passwordHash = hashPassword(password)
    summary = `Сброшен пароль пользователя ${current.login}`
  } else if (b.action === 'update') {
    const roleIds = Array.isArray(b.roleIds) ? b.roleIds.map(String) : current.roleIds
    if (roleIds.some((r) => !roles.some((x) => x.id === r))) throw badRequest('Указана несуществующая роль')
    if (!roleIds.length) throw badRequest('Назначьте хотя бы одну роль')
    const isActive = typeof b.isActive === 'boolean' ? b.isActive : current.isActive
    if (current.id === ctx.user.id) {
      // Prevent administrators from locking themselves out.
      if (!isActive) throw badRequest('Нельзя заблокировать собственную учётную запись')
      const keepsAdmin = roles.some((r) => roleIds.includes(r.id) && r.permissions.includes('admin.users.manage'))
      if (!keepsAdmin) throw badRequest('Нельзя лишить себя права управления пользователями')
    }
    changes = {}
    if (JSON.stringify([...current.roleIds].sort()) !== JSON.stringify([...roleIds].sort())) {
      changes.roleIds = { from: current.roleIds.map(roleName), to: roleIds.map(roleName) }
    }
    if (current.isActive !== isActive) changes.isActive = { from: current.isActive, to: isActive }
    patch.roleIds = roleIds
    patch.isActive = isActive
    summary = `Изменена учётная запись ${current.login}${changes.isActive ? (isActive ? ' (разблокирована)' : ' (заблокирована)') : ''}`
  } else {
    throw badRequest('Неизвестное действие')
  }

  const updated = await transaction(async (client) => {
    const u = await update('users', id, patch, client)
    if (!u.isActive) await client.query('DELETE FROM sessions WHERE user_id = $1', [id])
    await audit({ app: 'admin', action: `user.${b.action}`, entityType: 'user', entityId: id, userId: ctx.user.id, summary, changes }, client)
    return u
  })
  const [dto] = await toUserDTOs([updated])
  res.json(dto)
})

// Roles

async function userCount(roleId: string) {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE $1 = ANY(role_ids)', [roleId])
  return result.rows[0].count as number
}

router.get('/roles', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.roles.view', 'admin.users.view')
  const [roles, users] = await Promise.all([readTable('roles'), readTable('users')])
  res.json(roles.map((r) => ({ ...r, userCount: users.filter((u) => u.roleIds.includes(r.id)).length })))
})

router.post('/roles', async (req, res) => {
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.roles.manage')
  const input = parseRole(body(req))
  const roles = await readTable('roles')
  if (roles.some((r) => r.code === input.code)) throw badRequest('Роль с таким кодом уже существует')
  const now = nowISO()
  const role: Role = await insert('roles', { id: newId(), ...input, isSystem: false, createdAt: now, updatedAt: now })
  await audit({
    app: 'admin',
    action: 'role.create',
    entityType: 'role',
    entityId: role.id,
    userId: ctx.user.id,
    summary: `Создана роль «${role.name}» (${role.code}), прав: ${role.permissions.length}`,
  })
  res.status(201).json(role)
})

router.get('/roles/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.roles.view')
  const role = await findById('roles', id)
  if (!role) throw notFound('Роль не найдена')
  res.json({ ...role, userCount: await userCount(id) })
})

router.patch('/roles/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.roles.manage')
  const current = await findById('roles', id)
  if (!current) throw notFound('Роль не найдена')
  const input = parseRole(body(req))
  if (current.isSystem && input.code !== current.code) throw badRequest('Код системной роли изменить нельзя')
  const roles = await readTable('roles')
  if (ctx.user.roleIds.includes(id) && !input.permissions.includes('admin.roles.manage')) {
    const otherGrants = roles.some((r) => r.id !== id && ctx.user.roleIds.includes(r.id) && r.permissions.includes('admin.roles.manage'))
    if (!otherGrants) throw badRequest('Нельзя лишить себя права управления ролями')
  }
  if (roles.some((r) => r.id !== id && r.code === input.code)) throw badRequest('Роль с таким кодом уже существует')
  const updated = await update('roles', id, { ...input, updatedAt: nowISO() })
  const added = updated.permissions.filter((p) => !current.permissions.includes(p))
  const removed = current.permissions.filter((p) => !updated.permissions.includes(p))
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  if (current.name !== updated.name) changes.name = { from: current.name, to: updated.name }
  if (current.code !== updated.code) changes.code = { from: current.code, to: updated.code }
  if (current.description !== updated.description) changes.description = { from: current.description, to: updated.description }
  if (added.length || removed.length) changes.permissions = { from: removed.map(permissionLabel), to: added.map(permissionLabel) }
  await audit({
    app: 'admin',
    action: 'role.update',
    entityType: 'role',
    entityId: id,
    userId: ctx.user.id,
    summary: `Изменена роль «${updated.name}»: +${added.length} / −${removed.length} прав`,
    changes: Object.keys(changes).length ? changes : null,
  })
  res.json(updated)
})

router.delete('/roles/:id', async (req, res) => {
  const id = param(req, 'id')
  const ctx = await requireAuth(req)
  requirePermission(ctx, 'admin.roles.manage')
  const role = await findById('roles', id)
  if (!role) throw notFound('Роль не найдена')
  if (role.isSystem) throw badRequest('Системную роль удалить нельзя')
  if (await userCount(id)) throw badRequest('Роль назначена пользователям — сначала снимите её')
  await remove('roles', id)
  await audit({ app: 'admin', action: 'role.delete', entityType: 'role', entityId: id, userId: ctx.user.id, summary: `Удалена роль «${role.name}» (${role.code})` })
  res.json({ ok: true })
})

export default router
