import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pool } from './pool.js'

const migrationsDir = new URL('./migrations/', import.meta.url)

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
    for (const file of files) {
      const result = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file])
      if (result.rowCount) continue

      const sql = await readFile(join(migrationsDir.pathname, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Applied migration: ${file}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
