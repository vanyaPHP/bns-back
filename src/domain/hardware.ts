import type { Hardware, HardwareDTO } from '../lib/types.js'
import { HARDWARE_STATUS, HARDWARE_TYPE, isEnumValue } from '../lib/enums.js'
import { badRequest, isoDate, str } from '../http.js'
import { loadRefs } from './org.js'

export async function enrichHardware(rows: Hardware[]): Promise<HardwareDTO[]> {
  const { refs } = await loadRefs()
  return rows.map((h) => ({ ...h, employee: h.employeeId ? (refs.get(h.employeeId) ?? null) : null }))
}

export function parseHardwareFields(body: Record<string, unknown>) {
  if (!isEnumValue(HARDWARE_TYPE, body.type)) throw badRequest('Выберите тип оборудования')
  const status = body.status ?? 'in_stock'
  if (!isEnumValue(HARDWARE_STATUS, status)) throw badRequest('Некорректный статус')
  return {
    type: body.type,
    status,
    inventoryNumber: str(body.inventoryNumber, 'Инвентарный номер', { required: true, max: 40 }),
    manufacturer: str(body.manufacturer, 'Производитель', { required: true, max: 80 }),
    model: str(body.model, 'Модель', { required: true, max: 120 }),
    serialNumber: str(body.serialNumber, 'Серийный номер', { max: 80 }),
    purchaseDate: isoDate(body.purchaseDate, 'Дата покупки', false),
    warrantyUntil: isoDate(body.warrantyUntil, 'Гарантия до', false),
    notes: str(body.notes, 'Примечание', { max: 1000 }),
  }
}
