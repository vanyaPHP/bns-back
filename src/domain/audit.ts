import type { AppCode } from '../lib/enums.js'
import type { AuditLog } from '../lib/types.js'
import { type Db, insert, newId, nowISO } from '../db/tables.js'

export async function audit(
  entry: {
    app: AppCode
    action: string
    entityType: string
    entityId: string
    userId: string | null
    summary: string
    changes?: AuditLog['changes']
  },
  db?: Db,
) {
  await insert('audit_logs', { id: newId(), createdAt: nowISO(), changes: null, ...entry }, db)
}

/** Computes a flat field-level diff, used to show "from → to" in audit logs. */
export function diff(before: object, after: object, fields?: string[]): AuditLog['changes'] {
  const out: NonNullable<AuditLog['changes']> = {}
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = fields ?? Object.keys(a)
  for (const key of keys) {
    if (key === 'updatedAt' || key === 'createdAt' || key === 'passwordHash') continue
    const from = b[key]
    const to = a[key]
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from: from ?? null, to: to ?? null }
  }
  return Object.keys(out).length ? out : null
}

/** Replaces values of sensitive fields so personal data never lands in the audit log. */
export function mask(changes: AuditLog['changes'], fields: string[]): AuditLog['changes'] {
  if (!changes) return changes
  for (const f of fields) if (changes[f]) changes[f] = { from: 'скрыто', to: 'изменено' }
  return changes
}
