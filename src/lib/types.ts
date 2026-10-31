import type {
  AppCode,
  ApprovalStatus,
  DocumentType,
  EmployeeStatus,
  Gender,
  HardwareStatus,
  HardwareType,
  LeaveStatus,
  LeaveType,
  PurchaseStatus,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "./enums.js";

export interface Department {
  id: string;
  code: string;
  name: string;
  shortName: string;
  parentId: string | null;
  headEmployeeId: string;
  city: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  region: string;
  city: string;
  street: string;
  house: string;
  apartment: string;
  postalCode: string;
}

export interface Employee {
  id: string;
  personnelNumber: string;
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string;
  gender: Gender;
  position: string;
  departmentId: string;
  hireDate: string;
  status: EmployeeStatus;
  email: string;
  phone: string;
  workPhone: string;
  registrationAddress: Address;
  residentialAddress: Address;
  passport: {
    series: string;
    number: string;
    personalNumber: string;
    issuedBy: string;
    issuedAt: string;
  };
  bank: {
    bankName: string;
    bic: string;
    iban: string;
  };
  emergencyContact: {
    name: string;
    relation: string;
    phone: string;
  };
  education: string;
  hrManagerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  login: string;
  passwordHash: string;
  employeeId: string;
  roleIds: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditLog {
  id: string;
  app: AppCode;
  action: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export interface Hardware {
  id: string;
  inventoryNumber: string;
  type: HardwareType;
  manufacturer: string;
  model: string;
  serialNumber: string;
  status: HardwareStatus;
  employeeId: string | null;
  assignedAt: string | null;
  purchaseDate: string;
  warrantyUntil: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  requesterEmployeeId: string;
  createdByUserId: string;
  departmentId: string;
  hardwareId: string | null;
  assigneeEmployeeId: string | null;
  resolution: string;
  resolvedAt: string | null;
  closedAt: string | null;
  verifiedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  userId: string;
  text: string;
  kind: "comment" | "system";
  createdAt: string;
}

export interface PurchaseItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseRequest {
  id: string;
  number: number;
  ticketId: string;
  requestedByUserId: string;
  items: PurchaseItem[];
  justification: string;
  status: PurchaseStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionComment: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  type: DocumentType;
  title: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface ApprovalStep {
  approverEmployeeId: string | null;
  status: ApprovalStatus;
  decidedAt: string | null;
  comment: string;
}

export interface LeaveRequest {
  id: string;
  number: number;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  headApproval: ApprovalStep;
  hrApproval: ApprovalStep;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/** Session data exposed to the browser. */
export interface ClientSession {
  userId: string;
  login: string;
  employee: {
    id: string;
    fullName: string;
    shortName: string;
    firstName: string;
    position: string;
    departmentId: string;
    departmentName: string;
    email: string;
  };
  roles: { id: string; code: string; name: string }[];
  permissions: string[];
  headOfDepartmentIds: string[];
  isApprover: boolean;
}

/** Lightweight employee projection available to every authenticated user. */
export interface EmployeeRef {
  id: string;
  fullName: string;
  shortName: string;
  position: string;
  departmentId: string;
  departmentName: string;
}

export type HardwareDTO = Hardware & { employee: EmployeeRef | null };

export interface TicketDTO extends Ticket {
  code: string;
  requester: EmployeeRef | null;
  assignee: EmployeeRef | null;
  departmentName: string;
  hardware: Pick<Hardware, "id" | "inventoryNumber" | "type" | "manufacturer" | "model"> | null;
  openPurchases: number;
}

export type TicketAction =
  | "take"
  | "assign"
  | "set_priority"
  | "resolve"
  | "verify"
  | "return"
  | "cancel"
  | "resume"
  | "comment"
  | "request_purchase";

export interface TicketView {
  ticket: TicketDTO;
  verifiedBy: EmployeeRef | null;
  comments: (TicketComment & { author: EmployeeRef | null })[];
  purchases: (PurchaseRequest & { requestedBy: EmployeeRef | null; decidedBy: EmployeeRef | null })[];
  actions: TicketAction[];
}

export interface PurchaseDTO extends PurchaseRequest {
  total: number;
  ticket: { id: string; code: string; title: string } | null;
  requestedBy: EmployeeRef | null;
  decidedBy: EmployeeRef | null;
}

export interface AuditLogDTO extends AuditLog {
  user: { login: string; name: string } | null;
}

export interface EmployeeDTO extends Employee {
  fullName: string;
  departmentName: string;
  hrManager: EmployeeRef | null;
  headOf: { id: string; name: string }[];
}

export interface DepartmentDTO extends Department {
  head: EmployeeRef | null;
  employeeCount: number;
}

export interface DocumentDTO extends EmployeeDocument {
  employee: EmployeeRef | null;
  uploadedBy: string;
}

export interface LeaveDTO extends LeaveRequest {
  employee: EmployeeRef | null;
  headApprover: EmployeeRef | null;
  hrApprover: EmployeeRef | null;
  canApproveAs: ("head" | "hr")[];
  canCancel: boolean;
}

export interface LeaveBalance {
  year: number;
  entitlement: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface UserDTO extends Omit<User, "passwordHash"> {
  employee: EmployeeRef | null;
  roles: { id: string; code: string; name: string }[];
}

export interface RoleDTO extends Role {
  userCount: number;
}
