import type pg from 'pg'
import type {
  AuditLog,
  Department,
  Employee,
  EmployeeDocument,
  Hardware,
  LeaveRequest,
  PurchaseRequest,
  Role,
  Session,
  Ticket,
  TicketComment,
  User,
} from '../lib/types.js'
import { pool } from './pool.js'

export interface Tables {
  departments: Department
  employees: Employee
  users: User
  roles: Role
  sessions: Session
  audit_logs: AuditLog
  hardware: Hardware
  tickets: Ticket
  ticket_comments: TicketComment
  purchase_requests: PurchaseRequest
  employee_documents: EmployeeDocument
  leave_requests: LeaveRequest
}

export type TableName = keyof Tables
export type Db = pg.Pool | pg.PoolClient

/**
 * Column kinds:
 * - value: stored as-is (text, integer, boolean, text[])
 * - json: JSONB
 * - ts: TIMESTAMPTZ, exposed as ISO string (or null)
 * - date: nullable DATE, exposed as '' when empty
 */
type Kind = 'value' | 'json' | 'ts' | 'date'
type Columns = Record<string, [column: string, kind: Kind]>

const v = (column: string): [string, Kind] => [column, 'value']
const j = (column: string): [string, Kind] => [column, 'json']
const ts = (column: string): [string, Kind] => [column, 'ts']
const d = (column: string): [string, Kind] => [column, 'date']

const SCHEMA: Record<TableName, Columns> = {
  departments: {
    id: v('id'),
    code: v('code'),
    name: v('name'),
    shortName: v('short_name'),
    parentId: v('parent_id'),
    headEmployeeId: v('head_employee_id'),
    city: v('city'),
    description: v('description'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  employees: {
    id: v('id'),
    personnelNumber: v('personnel_number'),
    lastName: v('last_name'),
    firstName: v('first_name'),
    middleName: v('middle_name'),
    birthDate: d('birth_date'),
    gender: v('gender'),
    position: v('position'),
    departmentId: v('department_id'),
    hireDate: d('hire_date'),
    status: v('status'),
    email: v('email'),
    phone: v('phone'),
    workPhone: v('work_phone'),
    registrationAddress: j('registration_address'),
    residentialAddress: j('residential_address'),
    passport: j('passport'),
    bank: j('bank'),
    emergencyContact: j('emergency_contact'),
    education: v('education'),
    hrManagerId: v('hr_manager_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  users: {
    id: v('id'),
    login: v('login'),
    passwordHash: v('password_hash'),
    employeeId: v('employee_id'),
    roleIds: v('role_ids'),
    isActive: v('is_active'),
    lastLoginAt: ts('last_login_at'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  roles: {
    id: v('id'),
    code: v('code'),
    name: v('name'),
    description: v('description'),
    permissions: v('permissions'),
    isSystem: v('is_system'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  sessions: {
    id: v('id'),
    userId: v('user_id'),
    createdAt: ts('created_at'),
    expiresAt: ts('expires_at'),
  },
  audit_logs: {
    id: v('id'),
    app: v('app'),
    action: v('action'),
    entityType: v('entity_type'),
    entityId: v('entity_id'),
    userId: v('user_id'),
    summary: v('summary'),
    changes: j('changes'),
    createdAt: ts('created_at'),
  },
  hardware: {
    id: v('id'),
    inventoryNumber: v('inventory_number'),
    type: v('type'),
    manufacturer: v('manufacturer'),
    model: v('model'),
    serialNumber: v('serial_number'),
    status: v('status'),
    employeeId: v('employee_id'),
    assignedAt: ts('assigned_at'),
    purchaseDate: d('purchase_date'),
    warrantyUntil: d('warranty_until'),
    notes: v('notes'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  tickets: {
    id: v('id'),
    number: v('number'),
    title: v('title'),
    description: v('description'),
    category: v('category'),
    priority: v('priority'),
    status: v('status'),
    requesterEmployeeId: v('requester_employee_id'),
    createdByUserId: v('created_by_user_id'),
    departmentId: v('department_id'),
    hardwareId: v('hardware_id'),
    assigneeEmployeeId: v('assignee_employee_id'),
    resolution: v('resolution'),
    resolvedAt: ts('resolved_at'),
    closedAt: ts('closed_at'),
    verifiedByUserId: v('verified_by_user_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  ticket_comments: {
    id: v('id'),
    ticketId: v('ticket_id'),
    userId: v('user_id'),
    text: v('text'),
    kind: v('kind'),
    createdAt: ts('created_at'),
  },
  purchase_requests: {
    id: v('id'),
    number: v('number'),
    ticketId: v('ticket_id'),
    requestedByUserId: v('requested_by_user_id'),
    items: j('items'),
    justification: v('justification'),
    status: v('status'),
    decidedByUserId: v('decided_by_user_id'),
    decidedAt: ts('decided_at'),
    decisionComment: v('decision_comment'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  employee_documents: {
    id: v('id'),
    employeeId: v('employee_id'),
    type: v('type'),
    title: v('title'),
    fileName: v('file_name'),
    storedName: v('stored_name'),
    mimeType: v('mime_type'),
    size: v('size'),
    uploadedByUserId: v('uploaded_by_user_id'),
    createdAt: ts('created_at'),
  },
  leave_requests: {
    id: v('id'),
    number: v('number'),
    employeeId: v('employee_id'),
    type: v('type'),
    startDate: d('start_date'),
    endDate: d('end_date'),
    days: v('days'),
    reason: v('reason'),
    status: v('status'),
    headApproval: j('head_approval'),
    hrApproval: j('hr_approval'),
    createdByUserId: v('created_by_user_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
}

function fromRow<K extends TableName>(name: K, row: Record<string, unknown>): Tables[K] {
  const out: Record<string, unknown> = {}
  for (const [field, [column, kind]] of Object.entries(SCHEMA[name])) {
    const value = row[column]
    if (kind === 'ts') out[field] = value instanceof Date ? value.toISOString() : (value ?? null)
    else if (kind === 'date') out[field] = value ?? ''
    else out[field] = value
  }
  return out as unknown as Tables[K]
}

function toParams(name: TableName, entity: object): { columns: string[]; values: unknown[] } {
  const e = entity as Record<string, unknown>
  const columns: string[] = []
  const values: unknown[] = []
  for (const [field, [column, kind]] of Object.entries(SCHEMA[name])) {
    if (!(field in e)) continue
    const value = e[field]
    columns.push(column)
    if (kind === 'json') values.push(value == null ? null : JSON.stringify(value))
    else if (kind === 'date' || kind === 'ts') values.push(value || null)
    else values.push(value)
  }
  return { columns, values }
}

export async function readTable<K extends TableName>(name: K, db: Db = pool): Promise<Tables[K][]> {
  const result = await db.query(`SELECT * FROM ${name}`)
  return result.rows.map((row) => fromRow(name, row))
}

export async function findById<K extends TableName>(name: K, id: string, db: Db = pool): Promise<Tables[K] | undefined> {
  const result = await db.query(`SELECT * FROM ${name} WHERE id = $1`, [id])
  return result.rows[0] ? fromRow(name, result.rows[0]) : undefined
}

export async function insert<K extends TableName>(name: K, row: Tables[K], db: Db = pool): Promise<Tables[K]> {
  const { columns, values } = toParams(name, row)
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
  const result = await db.query(`INSERT INTO ${name} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`, values)
  return fromRow(name, result.rows[0])
}

/** Updates the given fields of a row; returns the full updated row. */
export async function update<K extends TableName>(name: K, id: string, patch: Partial<Tables[K]>, db: Db = pool): Promise<Tables[K]> {
  const { columns, values } = toParams(name, patch)
  const pairs = columns.map((column, i) => [column, values[i]] as const).filter(([column]) => column !== 'id')
  const set = pairs.map(([column], i) => `${column} = $${i + 2}`)
  const result = await db.query(`UPDATE ${name} SET ${set.join(', ')} WHERE id = $1 RETURNING *`, [id, ...pairs.map(([, value]) => value)])
  if (!result.rows[0]) throw new Error(`${name} row ${id} not found for update`)
  return fromRow(name, result.rows[0])
}

export async function remove(name: TableName, id: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM ${name} WHERE id = $1`, [id])
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Next sequential number for a numbered table; must run inside a transaction. */
export async function nextNumber(client: pg.PoolClient, name: 'tickets' | 'purchase_requests' | 'leave_requests'): Promise<number> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [name])
  const result = await client.query(`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ${name}`)
  return Number(result.rows[0].next)
}

export function newId(): string {
  return crypto.randomUUID()
}

export function nowISO(): string {
  return new Date().toISOString()
}
