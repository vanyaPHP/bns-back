import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { pool } from './db/pool.js'
import filesRouter from './routes/files.js'

const app = express()
const port = Number(process.env.PORT ?? 4000)
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000'

app.use(helmet())
app.use(cors({ origin: corsOrigin.split(',').map((origin) => origin.trim()) }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('combined'))

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok', database: 'connected' })
  } catch {
    response.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.use('/api/files', filesRouter)

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof Error && error.message.includes('File too large')) {
    response.status(413).json({ error: 'File exceeds the configured size limit' })
    return
  }
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
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
