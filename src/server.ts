import 'dotenv/config'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmetModule, { type HelmetOptions } from 'helmet'
import morgan from 'morgan'
import multer from 'multer'
import { pool } from './db/pool.js'
import { HttpError } from './http.js'
import adminRouter from './routes/admin.js'
import auditRouter from './routes/audit.js'
import authRouter from './routes/auth.js'
import { hardwareRouter, myHardwareRouter } from './routes/hardware.js'
import hrRouter from './routes/hr.js'
import leaveRouter from './routes/leave.js'
import lookupRouter from './routes/lookup.js'
import purchasesRouter from './routes/purchases.js'
import ticketsRouter from './routes/tickets.js'

const app = express()
const port = Number(process.env.PORT ?? 4000)
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000'

// helmet's CJS typings resolve to a namespace (callable via .default) under some resolvers, e.g. Vercel's build.
type HelmetFn = (options?: HelmetOptions) => express.RequestHandler
const helmet = ((helmetModule as unknown as { default?: HelmetFn }).default ?? helmetModule) as unknown as HelmetFn

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: corsOrigin.split(',').map((origin) => origin.trim()), credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(morgan('combined'))

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok', database: 'connected' })
  } catch {
    response.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/audit', auditRouter)
app.use('/api/hr', hrRouter)
app.use('/api/hardware', hardwareRouter)
app.use('/api/my/hardware', myHardwareRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/purchases', purchasesRouter)
app.use('/api/leave', leaveRouter)
app.use('/api/lookup', lookupRouter)

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Ресурс не найден' })
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message })
    return
  }
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? `Размер файла не должен превышать ${process.env.MAX_FILE_SIZE_MB ?? 10} МБ` : 'Некорректная загрузка файла'
    response.status(400).json({ error: message })
    return
  }
  const e = error as { type?: string; code?: string }
  if (e.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Некорректное тело запроса' })
    return
  }
  if (e.code === '23505') {
    response.status(409).json({ error: 'Запись с такими данными уже существует' })
    return
  }
  console.error(error)
  response.status(500).json({ error: 'Внутренняя ошибка сервера' })
})

const server = app.listen(port, () => {
  console.log(`bns-back listening on http://localhost:${port}`)
})

const shutdown = async () => {
  server.close()
  await pool.end()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export default app
