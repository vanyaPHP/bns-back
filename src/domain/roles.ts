import { ALL_PERMISSIONS } from '../lib/permissions.js'
import { badRequest, str } from '../http.js'

export function parseRole(body: Record<string, unknown>) {
  const code = str(body.code, 'Код роли', { required: true, max: 50 })
  if (!/^[a-z][a-z0-9_]*$/.test(code)) throw badRequest('Код роли: строчные латинские буквы, цифры и «_», например hr_manager')
  const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions.map(String))] : []
  const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p))
  if (unknown.length) throw badRequest(`Неизвестные права: ${unknown.join(', ')}`)
  return {
    code,
    name: str(body.name, 'Название', { required: true, max: 100 }),
    description: str(body.description, 'Описание', { max: 500 }),
    permissions,
  }
}
