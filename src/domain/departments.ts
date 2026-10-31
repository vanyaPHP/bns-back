import type { Department, DepartmentDTO } from '../lib/types.js'
import { readTable } from '../db/tables.js'
import { badRequest, str } from '../http.js'
import { descendantIds, loadRefs } from './org.js'

export async function toDepartmentDTOs(rows: Department[]): Promise<DepartmentDTO[]> {
  const { employees, refs } = await loadRefs()
  return rows.map((d) => ({
    ...d,
    head: refs.get(d.headEmployeeId) ?? null,
    employeeCount: employees.filter((e) => e.departmentId === d.id && e.status !== 'dismissed').length,
  }))
}

export async function parseDepartment(body: Record<string, unknown>, selfId?: string) {
  const [departments, employees] = await Promise.all([readTable('departments'), readTable('employees')])
  const name = str(body.name, 'Название', { required: true, max: 200 })
  const code = str(body.code, 'Код', { required: true, max: 20 }).toUpperCase()
  if (departments.some((d) => d.id !== selfId && d.code === code)) throw badRequest('Подразделение с таким кодом уже существует')
  const parentId = str(body.parentId, 'Вышестоящее подразделение') || null
  if (parentId) {
    if (!departments.some((d) => d.id === parentId)) throw badRequest('Вышестоящее подразделение не найдено')
    if (selfId && descendantIds(departments, selfId).includes(parentId)) throw badRequest('Нельзя подчинить подразделение самому себе или дочернему')
  }
  // Every department must have a head.
  const headEmployeeId = str(body.headEmployeeId, 'Руководитель', { required: true })
  const head = employees.find((e) => e.id === headEmployeeId)
  if (!head || head.status === 'dismissed') throw badRequest('Руководитель не найден или уволен')
  return {
    name,
    code,
    parentId,
    headEmployeeId,
    shortName: str(body.shortName, 'Краткое название', { max: 40 }) || name,
    city: str(body.city, 'Город', { required: true, max: 80 }),
    description: str(body.description, 'Описание', { max: 1000 }),
  }
}
