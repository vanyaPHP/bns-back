import path from 'node:path'
import { del, get, put } from '@vercel/blob'
import multer from 'multer'
import { DOCUMENT_TYPE, isEnumValue } from '../lib/enums.js'
import type { EmployeeDocument } from '../lib/types.js'
import { newId, nowISO } from '../db/tables.js'
import { badRequest } from '../http.js'

const MAX_SIZE = Number(process.env.MAX_FILE_SIZE_MB ?? 10) * 1024 * 1024

// MIME type is derived from the whitelisted extension, never trusted from the client.
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8',
}

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1 },
  defParamCharset: 'utf8',
}).single('file')

export async function storeUpload(
  file: Express.Multer.File | undefined,
  fields: Record<string, unknown>,
  employeeId: string,
  userId: string,
): Promise<EmployeeDocument> {
  if (!file || file.size === 0) throw badRequest('Выберите файл')
  const ext = path.extname(file.originalname).toLowerCase()
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) throw badRequest('Допустимые форматы: PDF, PNG, JPG, DOC(X), XLS(X), TXT')
  if (!isEnumValue(DOCUMENT_TYPE, fields.type)) throw badRequest('Выберите тип документа')
  const title = String(fields.title ?? '').trim().slice(0, 200) || file.originalname

  const id = newId()
  const blob = await put(`employee-documents/${employeeId}/${id}${ext}`, file.buffer, {
    access: 'private',
    contentType: mimeType,
    addRandomSuffix: false,
  })
  return {
    id,
    employeeId,
    type: fields.type,
    title,
    fileName: path.basename(file.originalname),
    storedName: blob.pathname,
    mimeType,
    size: file.size,
    uploadedByUserId: userId,
    createdAt: nowISO(),
  }
}

export async function readUpload(storedName: string) {
  const result = await get(storedName, { access: 'private' })
  return result?.statusCode === 200 ? result.stream : null
}

export async function deleteUpload(storedName: string) {
  await del(storedName)
}
