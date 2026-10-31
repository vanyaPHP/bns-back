import type { Request } from 'express'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg)
export const forbidden = (msg = 'Недостаточно прав для выполнения операции') => new HttpError(403, msg)
export const notFound = (msg = 'Объект не найден') => new HttpError(404, msg)

export function body(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
}

/** Single string query parameter, or null when absent or repeated. */
export function query(req: Request, name: string): string | null {
  const value = req.query[name]
  return typeof value === 'string' ? value : null
}

export function param(req: Request, name: string): string {
  return String(req.params[name])
}

export function str(value: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string {
  const v = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  if (opts.required && !v) throw badRequest(`Поле «${field}» обязательно для заполнения`)
  if (opts.max && v.length > opts.max) throw badRequest(`Поле «${field}» слишком длинное`)
  return v
}

export function isoDate(value: unknown, field: string, required = true): string {
  const v = str(value, field, { required })
  if (!v) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw badRequest(`Поле «${field}» должно быть датой`)
  return v
}
