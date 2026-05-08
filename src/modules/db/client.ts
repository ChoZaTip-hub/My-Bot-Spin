import * as NodeModule from 'node:module'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { bootstrapSqliteSchema } from './bootstrap'
import * as schema from './schema'

const requireNative = NodeModule.createRequire(import.meta.url)
type SqliteDatabase = import('better-sqlite3').Database
type SqliteConstructor = new (path: string) => SqliteDatabase
const BetterSqlite3 = requireNative('better-sqlite3') as SqliteConstructor

export type DbClient = {
  db: ReturnType<typeof drizzle<typeof schema>>
  sqlite: SqliteDatabase
}

export function createDb(dbPath: string): DbClient {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new BetterSqlite3(dbPath)
  sqlite.pragma('journal_mode = WAL')
  bootstrapSqliteSchema(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}
