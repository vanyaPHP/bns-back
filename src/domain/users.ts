import type { User, UserDTO } from '../lib/types.js'
import { readTable } from '../db/tables.js'
import { loadRefs } from './org.js'

export async function toUserDTOs(users: User[]): Promise<UserDTO[]> {
  const [roles, { refs }] = await Promise.all([readTable('roles'), loadRefs()])
  return users.map(({ passwordHash: _passwordHash, ...u }) => ({
    ...u,
    employee: refs.get(u.employeeId) ?? null,
    roles: roles.filter((r) => u.roleIds.includes(r.id)).map((r) => ({ id: r.id, code: r.code, name: r.name })),
  }))
}
