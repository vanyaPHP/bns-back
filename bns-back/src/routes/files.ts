import { del, put } from '@vercel/blob'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { pool } from '../db/pool.js'

const router = Router()
const maxFileSize = Number(process.env.MAX_FILE_SIZE_MB ?? 10) * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize },
})

const idSchema = z.string().uuid()

router.get('/', async (request, response, next) => {
  try {
    const ownerId = typeof request.query.ownerId === 'string' ? request.query.ownerId : null
    const result = ownerId
      ? await pool.query('SELECT id, pathname, original_name, content_type, size_bytes, owner_id, created_at FROM files WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId])
      : await pool.query('SELECT id, pathname, original_name, content_type, size_bytes, owner_id, created_at FROM files ORDER BY created_at DESC')
    response.json({ files: result.rows })
  } catch (error) {
    next(error)
  }
})

router.post('/', upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'A file field is required' })
      return
    }

    const ownerId = typeof request.body.ownerId === 'string' ? request.body.ownerId : null
    const pathname = `uploads/${crypto.randomUUID()}-${request.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const blob = await put(pathname, request.file.buffer, {
      access: 'private',
      contentType: request.file.mimetype,
      addRandomSuffix: false,
    })
    const result = await pool.query(
      'INSERT INTO files (pathname, original_name, content_type, size_bytes, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, pathname, original_name, content_type, size_bytes, owner_id, created_at',
      [blob.pathname, request.file.originalname, request.file.mimetype, request.file.size, ownerId],
    )
    response.status(201).json({ file: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (request, response, next) => {
  try {
    const id = idSchema.safeParse(request.params.id)
    if (!id.success) {
      response.status(400).json({ error: 'Invalid file id' })
      return
    }
    const result = await pool.query('DELETE FROM files WHERE id = $1 RETURNING pathname', [id.data])
    if (!result.rowCount) {
      response.status(404).json({ error: 'File not found' })
      return
    }
    await del(result.rows[0].pathname)
    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

export default router
