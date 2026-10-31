import { Router } from 'express'
import { readTable, update, nowISO } from '../db/tables.js'
import { audit } from '../domain/audit.js'
import { createSession, destroySession, requireAuth, toClientSession } from '../domain/auth.js'
import { verifyPassword } from '../domain/password.js'
import { HttpError, body, str } from '../http.js'

const router = Router()

router.post('/login', async (req, res) => {
  const b = body(req)
  const login = str(b.login, 'Логин', { required: true }).toLowerCase()
  const password = str(b.password, 'Пароль', { required: true })
  const users = await readTable('users')
  const user = users.find((u) => u.login.toLowerCase() === login)
  if (!user || !verifyPassword(password, user.passwordHash)) throw new HttpError(401, 'Неверный логин или пароль')
  if (!user.isActive) throw new HttpError(403, 'Учётная запись заблокирована. Обратитесь к администратору')
  await update('users', user.id, { lastLoginAt: nowISO() })
  await createSession(res, user.id)
  await audit({ app: 'admin', action: 'auth.login', entityType: 'user', entityId: user.id, userId: user.id, summary: `Вход в систему: ${user.login}` })
  res.json({ ok: true })
})

router.post('/logout', async (req, res) => {
  await destroySession(req, res)
  res.json({ ok: true })
})

router.get('/me', async (req, res) => {
  res.json(toClientSession(await requireAuth(req)))
})

export default router
