/**
 * Machine values are stored in English; UI labels are Russian.
 * Every enum maps value -> { label, tone } so badges render consistently.
 */
export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet" | "cyan" | "orange";

export interface EnumOption {
  label: string;
  tone: Tone;
}

function defineEnum<const T extends Record<string, EnumOption>>(map: T) {
  return map;
}

export function enumLabel<T extends Record<string, EnumOption>>(map: T, value: string | null | undefined): string {
  if (!value) return "—";
  return (map as Record<string, EnumOption>)[value]?.label ?? value;
}

export function enumOptions<T extends Record<string, EnumOption>>(map: T) {
  return (Object.keys(map) as (keyof T & string)[]).map((value) => ({ value, label: map[value].label }));
}

export function isEnumValue<T extends Record<string, EnumOption>>(map: T, value: unknown): value is keyof T & string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(map, value);
}

export const APP_CODES = ["admin", "hr", "it", "vacation"] as const;
export type AppCode = (typeof APP_CODES)[number];

export const APP_LABELS: Record<AppCode, string> = {
  admin: "Администрирование",
  hr: "Персонал",
  it: "ИТ-поддержка",
  vacation: "Отпуска",
};

export const TICKET_STATUS = defineEnum({
  new: { label: "Новая", tone: "blue" },
  in_progress: { label: "В работе", tone: "violet" },
  waiting_purchase: { label: "Ожидает закупки", tone: "amber" },
  resolved: { label: "На проверке", tone: "cyan" },
  closed: { label: "Закрыта", tone: "green" },
  cancelled: { label: "Отменена", tone: "gray" },
});
export type TicketStatus = keyof typeof TICKET_STATUS;
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["new", "in_progress", "waiting_purchase", "resolved"];

export const TICKET_PRIORITY = defineEnum({
  low: { label: "Низкий", tone: "gray" },
  medium: { label: "Средний", tone: "blue" },
  high: { label: "Высокий", tone: "orange" },
  critical: { label: "Критический", tone: "red" },
});
export type TicketPriority = keyof typeof TICKET_PRIORITY;

export const TICKET_CATEGORY = defineEnum({
  hardware: { label: "Оборудование", tone: "blue" },
  software: { label: "Программное обеспечение", tone: "violet" },
  network: { label: "Сеть и связь", tone: "cyan" },
  access: { label: "Доступы и учётные записи", tone: "amber" },
  other: { label: "Другое", tone: "gray" },
});
export type TicketCategory = keyof typeof TICKET_CATEGORY;

export const PURCHASE_STATUS = defineEnum({
  in_progress: { label: "На согласовании", tone: "amber" },
  approved: { label: "Одобрена", tone: "green" },
  rejected: { label: "Отклонена", tone: "red" },
  delivered: { label: "Получена", tone: "blue" },
});
export type PurchaseStatus = keyof typeof PURCHASE_STATUS;

export const HARDWARE_TYPE = defineEnum({
  laptop: { label: "Ноутбук", tone: "blue" },
  desktop: { label: "Системный блок", tone: "blue" },
  monitor: { label: "Монитор", tone: "cyan" },
  printer: { label: "Принтер / МФУ", tone: "violet" },
  phone: { label: "IP-телефон", tone: "amber" },
  mobile: { label: "Смартфон", tone: "amber" },
  tablet: { label: "Планшет", tone: "orange" },
  peripheral: { label: "Периферия", tone: "gray" },
  network: { label: "Сетевое оборудование", tone: "green" },
  other: { label: "Другое", tone: "gray" },
});
export type HardwareType = keyof typeof HARDWARE_TYPE;

export const HARDWARE_STATUS = defineEnum({
  in_stock: { label: "На складе", tone: "gray" },
  assigned: { label: "Выдано", tone: "green" },
  repair: { label: "В ремонте", tone: "amber" },
  written_off: { label: "Списано", tone: "red" },
});
export type HardwareStatus = keyof typeof HARDWARE_STATUS;

export const LEAVE_TYPE = defineEnum({
  annual: { label: "Ежегодный отпуск", tone: "green" },
  sick: { label: "Больничный", tone: "red" },
  unpaid: { label: "Отпуск без сохранения з/п", tone: "amber" },
  study: { label: "Учебный отпуск", tone: "violet" },
});
export type LeaveType = keyof typeof LEAVE_TYPE;

export const LEAVE_STATUS = defineEnum({
  pending: { label: "На согласовании", tone: "amber" },
  approved: { label: "Согласовано", tone: "green" },
  rejected: { label: "Отклонено", tone: "red" },
  cancelled: { label: "Отменено", tone: "gray" },
});
export type LeaveStatus = keyof typeof LEAVE_STATUS;

export const APPROVAL_STATUS = defineEnum({
  pending: { label: "Ожидает", tone: "amber" },
  approved: { label: "Согласовано", tone: "green" },
  rejected: { label: "Отклонено", tone: "red" },
  skipped: { label: "Не требуется", tone: "gray" },
});
export type ApprovalStatus = keyof typeof APPROVAL_STATUS;

export const EMPLOYEE_STATUS = defineEnum({
  active: { label: "Работает", tone: "green" },
  probation: { label: "Испытательный срок", tone: "blue" },
  dismissed: { label: "Уволен", tone: "gray" },
});
export type EmployeeStatus = keyof typeof EMPLOYEE_STATUS;

export const GENDER = defineEnum({
  male: { label: "Мужской", tone: "blue" },
  female: { label: "Женский", tone: "violet" },
});
export type Gender = keyof typeof GENDER;

export const DOCUMENT_TYPE = defineEnum({
  passport: { label: "Паспорт", tone: "blue" },
  employment_contract: { label: "Трудовой договор", tone: "green" },
  diploma: { label: "Диплом об образовании", tone: "violet" },
  medical_certificate: { label: "Медицинская справка", tone: "red" },
  military_id: { label: "Военный билет", tone: "amber" },
  insurance: { label: "Страховое свидетельство", tone: "cyan" },
  photo: { label: "Фотография", tone: "orange" },
  other: { label: "Другое", tone: "gray" },
});
export type DocumentType = keyof typeof DOCUMENT_TYPE;

/** Annual paid leave entitlement in calendar days. */
export const ANNUAL_LEAVE_DAYS = 24;
