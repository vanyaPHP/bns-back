import { Router } from 'express'
import { readTable } from '../db/tables.js'
import { requireAuth } from '../domain/auth.js'
import { loadRefs, managedDepartmentIds } from '../domain/org.js'
import { engineerIds } from '../domain/tickets.js'
import { query } from '../http.js'

const router = Router()

/** Minimal employee directory available to every authenticated user. */
router.get('/employees', async (req, res) => {
  const ctx = await requireAuth(req)
  const scope = query(req, 'scope')
  const departmentId = query(req, 'departmentId')
  const { employees, departments, refs } = await loadRefs()
  let list = employees.filter((e) => e.status !== 'dismissed')
  if (scope === 'managed') {
    const managed = managedDepartmentIds(departments, ctx.employee.id)
    list = list.filter((e) => e.id === ctx.employee.id || managed.has(e.departmentId))
  }
  if (departmentId) list = list.filter((e) => e.departmentId === departmentId)
  res.json(list.map((e) => refs.get(e.id)!).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')))
})

router.get('/departments', async (req, res) => {
  await requireAuth(req)
  const departments = await readTable('departments')
  res.json(departments.map(({ id, name, shortName, parentId, code }) => ({ id, name, shortName, parentId, code })))
})

router.get('/engineers', async (req, res) => {
  await requireAuth(req)
  const [ids, { refs }] = await Promise.all([engineerIds(), loadRefs()])
  res.json([...ids].map((id) => refs.get(id)).filter(Boolean))
})

export default router
