import { ANNUAL_LEAVE_DAYS } from '../lib/enums.js'
import type { ApprovalStep, Employee, LeaveDTO, LeaveRequest } from '../lib/types.js'
import { todayISO } from '../lib/format.js'
import { type Db, readTable } from '../db/tables.js'
import type { AuthContext } from './auth.js'
import { loadRefs, managedDepartmentIds, resolveHeadApprover } from './org.js'

export function step(approverId: string | null, employeeId: string): ApprovalStep {
  const skip = !approverId || approverId === employeeId
  return { approverEmployeeId: skip ? null : approverId, status: skip ? 'skipped' : 'pending', decidedAt: null, comment: '' }
}

export async function resolveApprovers(employee: Employee) {
  const departments = await readTable('departments')
  const head = resolveHeadApprover(employee, departments)
  let hr = employee.hrManagerId
  if (!hr) {
    // Fall back to the head of the HR department.
    const hrDept = departments.find((d) => d.code === 'BN-100')
    hr = hrDept?.headEmployeeId ?? null
  }
  return { head: step(head, employee.id), hr: step(hr, employee.id) }
}

export function overallStatus(l: Pick<LeaveRequest, 'headApproval' | 'hrApproval' | 'status'>): LeaveRequest['status'] {
  if (l.status === 'cancelled') return 'cancelled'
  const steps = [l.headApproval, l.hrApproval]
  if (steps.some((s) => s.status === 'rejected')) return 'rejected'
  if (steps.every((s) => s.status === 'approved' || s.status === 'skipped')) return 'approved'
  return 'pending'
}

export async function annualBalance(employeeId: string, year: number, db?: Db) {
  const leaves = await readTable('leave_requests', db)
  const relevant = leaves.filter((l) => l.employeeId === employeeId && l.type === 'annual' && l.startDate.startsWith(String(year)))
  const used = relevant.filter((l) => l.status === 'approved').reduce((s, l) => s + l.days, 0)
  const pending = relevant.filter((l) => l.status === 'pending').reduce((s, l) => s + l.days, 0)
  return { year, entitlement: ANNUAL_LEAVE_DAYS, used, pending, remaining: ANNUAL_LEAVE_DAYS - used - pending }
}

export function approverRoles(ctx: AuthContext, l: LeaveRequest): ('head' | 'hr')[] {
  const out: ('head' | 'hr')[] = []
  if (l.status !== 'pending') return out
  if (l.headApproval.approverEmployeeId === ctx.employee.id && l.headApproval.status === 'pending') out.push('head')
  if (l.hrApproval.approverEmployeeId === ctx.employee.id && l.hrApproval.status === 'pending') out.push('hr')
  return out
}

export function canCancel(ctx: AuthContext, l: LeaveRequest, today: string) {
  return l.employeeId === ctx.employee.id && (l.status === 'pending' || (l.status === 'approved' && l.startDate > today))
}

export async function toLeaveDTOs(rows: LeaveRequest[], ctx: AuthContext): Promise<LeaveDTO[]> {
  const { refs } = await loadRefs()
  const today = todayISO()
  return rows.map((l) => ({
    ...l,
    employee: refs.get(l.employeeId) ?? null,
    headApprover: l.headApproval.approverEmployeeId ? (refs.get(l.headApproval.approverEmployeeId) ?? null) : null,
    hrApprover: l.hrApproval.approverEmployeeId ? (refs.get(l.hrApproval.approverEmployeeId) ?? null) : null,
    canApproveAs: approverRoles(ctx, l),
    canCancel: canCancel(ctx, l, today),
  }))
}

/** Whether the user may see another employee's leave requests. */
export async function canSeeEmployeeLeaves(ctx: AuthContext, employeeId: string) {
  if (employeeId === ctx.employee.id) return true
  if (ctx.permissions.has('vacation.view_all') || ctx.permissions.has('hr.employees.view')) return true
  const [employees, departments] = await Promise.all([readTable('employees'), readTable('departments')])
  const emp = employees.find((e) => e.id === employeeId)
  if (!emp) return false
  if (emp.hrManagerId === ctx.employee.id) return true
  return managedDepartmentIds(departments, ctx.employee.id).has(emp.departmentId)
}
