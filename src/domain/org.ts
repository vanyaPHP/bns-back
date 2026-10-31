import type { Department, Employee, EmployeeRef } from '../lib/types.js'
import { fullName, shortName } from '../lib/format.js'
import { readTable } from '../db/tables.js'

export function toEmployeeRef(e: Employee, departments: Department[]): EmployeeRef {
  return {
    id: e.id,
    fullName: fullName(e),
    shortName: shortName(e),
    position: e.position,
    departmentId: e.departmentId,
    departmentName: departments.find((d) => d.id === e.departmentId)?.name ?? '',
  }
}

export async function loadRefs() {
  const [employees, departments] = await Promise.all([readTable('employees'), readTable('departments')])
  const map = new Map(employees.map((e) => [e.id, toEmployeeRef(e, departments)]))
  return { employees, departments, refs: map }
}

/** Department id plus all nested sub-department ids. */
export function descendantIds(departments: Department[], rootId: string): string[] {
  const out = [rootId]
  for (let i = 0; i < out.length; i++) {
    for (const d of departments) if (d.parentId === out[i]) out.push(d.id)
  }
  return out
}

/** All departments (including nested) managed by the given employee. */
export function managedDepartmentIds(departments: Department[], employeeId: string): Set<string> {
  const set = new Set<string>()
  for (const d of departments) {
    if (d.headEmployeeId === employeeId) descendantIds(departments, d.id).forEach((id) => set.add(id))
  }
  return set
}

/**
 * The head who approves an employee's requests: the head of their department,
 * or the head of the parent department when the employee heads their own department.
 */
export function resolveHeadApprover(employee: Employee, departments: Department[]): string | null {
  let dept = departments.find((d) => d.id === employee.departmentId)
  while (dept) {
    if (dept.headEmployeeId && dept.headEmployeeId !== employee.id) return dept.headEmployeeId
    dept = dept.parentId ? departments.find((d) => d.id === dept!.parentId) : undefined
  }
  return null
}
