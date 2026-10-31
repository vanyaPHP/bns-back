import { EMPLOYEE_STATUS, GENDER, isEnumValue } from '../lib/enums.js'
import type { Address, Employee, EmployeeDTO } from '../lib/types.js'
import { fullName } from '../lib/format.js'
import { badRequest, isoDate, str } from '../http.js'
import type { AuthContext } from './auth.js'
import { loadRefs } from './org.js'

function address(raw: unknown, label: string, required: boolean): Address {
  const a = (raw ?? {}) as Record<string, unknown>
  return {
    region: str(a.region, `${label}: область`, { max: 100 }),
    city: str(a.city, `${label}: населённый пункт`, { required, max: 100 }),
    street: str(a.street, `${label}: улица`, { required, max: 150 }),
    house: str(a.house, `${label}: дом`, { required, max: 20 }),
    apartment: str(a.apartment, `${label}: квартира`, { max: 20 }),
    postalCode: str(a.postalCode, `${label}: индекс`, { max: 10 }),
  }
}

export type EmployeeInput = Omit<Employee, 'id' | 'personnelNumber' | 'hrManagerId' | 'createdAt' | 'updatedAt'>

export function parseEmployee(body: Record<string, unknown>): EmployeeInput {
  if (!isEnumValue(GENDER, body.gender)) throw badRequest('Укажите пол')
  const status = body.status ?? 'probation'
  if (!isEnumValue(EMPLOYEE_STATUS, status)) throw badRequest('Некорректный статус')
  const email = str(body.email, 'Email', { required: true, max: 120 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Некорректный email')
  const phone = str(body.phone, 'Мобильный телефон', { required: true, max: 30 })
  if (!/^\+?[\d\s()-]{7,}$/.test(phone)) throw badRequest('Некорректный номер телефона')
  const passport = (body.passport ?? {}) as Record<string, unknown>
  const bank = (body.bank ?? {}) as Record<string, unknown>
  const emergency = (body.emergencyContact ?? {}) as Record<string, unknown>
  const iban = str(bank.iban, 'IBAN', { required: true, max: 34 }).replace(/\s/g, '').toUpperCase()
  if (!/^BY\d{2}[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$/.test(iban)) throw badRequest('IBAN должен быть в формате BY00XXXX0000XXXXXXXXXXXXXXXX (28 символов)')
  const registrationAddress = address(body.registrationAddress, 'Адрес регистрации', true)
  const residentialAddress = body.sameAddress ? { ...registrationAddress } : address(body.residentialAddress, 'Адрес проживания', true)
  const birthDate = isoDate(body.birthDate, 'Дата рождения')
  const hireDate = isoDate(body.hireDate, 'Дата приёма')
  if (birthDate >= hireDate) throw badRequest('Дата рождения должна быть раньше даты приёма')

  return {
    lastName: str(body.lastName, 'Фамилия', { required: true, max: 60 }),
    firstName: str(body.firstName, 'Имя', { required: true, max: 60 }),
    middleName: str(body.middleName, 'Отчество', { max: 60 }),
    birthDate,
    gender: body.gender,
    position: str(body.position, 'Должность', { required: true, max: 150 }),
    departmentId: str(body.departmentId, 'Подразделение', { required: true }),
    hireDate,
    status,
    email,
    phone,
    workPhone: str(body.workPhone, 'Рабочий телефон', { max: 30 }),
    registrationAddress,
    residentialAddress,
    passport: {
      series: str(passport.series, 'Серия паспорта', { required: true, max: 4 }).toUpperCase(),
      number: str(passport.number, 'Номер паспорта', { required: true, max: 10 }),
      personalNumber: str(passport.personalNumber, 'Идентификационный номер', { required: true, max: 14 }).toUpperCase(),
      issuedBy: str(passport.issuedBy, 'Кем выдан', { required: true, max: 200 }),
      issuedAt: isoDate(passport.issuedAt, 'Дата выдачи'),
    },
    bank: {
      bankName: str(bank.bankName, 'Банк', { required: true, max: 120 }),
      bic: str(bank.bic, 'БИК', { required: true, max: 11 }).toUpperCase(),
      iban,
    },
    emergencyContact: {
      name: str(emergency.name, 'Контактное лицо', { max: 120 }),
      relation: str(emergency.relation, 'Степень родства', { max: 60 }),
      phone: str(emergency.phone, 'Телефон контактного лица', { max: 30 }),
    },
    education: str(body.education, 'Образование', { max: 300 }),
  }
}

/** Removes passport and bank data for users without the sensitive-data permission. */
export function redactEmployee(e: Employee, ctx: AuthContext): Employee {
  if (ctx.permissions.has('hr.employees.sensitive')) return e
  return {
    ...e,
    passport: { series: '••', number: '•••••••', personalNumber: '••••••••••••••', issuedBy: 'Скрыто', issuedAt: '' },
    bank: { bankName: 'Скрыто', bic: '••••', iban: 'BY•• •••• •••• •••• •••• •••• ••••' },
  }
}

export async function toEmployeeDTOs(rows: Employee[], ctx: AuthContext): Promise<EmployeeDTO[]> {
  const { departments, refs } = await loadRefs()
  return rows.map((e) => ({
    ...redactEmployee(e, ctx),
    fullName: fullName(e),
    departmentName: departments.find((d) => d.id === e.departmentId)?.name ?? '',
    hrManager: e.hrManagerId ? (refs.get(e.hrManagerId) ?? null) : null,
    headOf: departments.filter((d) => d.headEmployeeId === e.id).map((d) => ({ id: d.id, name: d.name })),
  }))
}
