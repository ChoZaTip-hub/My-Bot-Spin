import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const strategies = sqliteTable('strategies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const strategyVersions = sqliteTable(
  'strategy_versions',
  {
    id: text('id').primaryKey(),
    strategyId: text('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    configJson: text('config_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('strategy_versions_strategy_idx').on(t.strategyId)]
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    mode: text('mode').notNull(),
    state: text('state').notNull(),
    strategyVersionId: text('strategy_version_id').references(() => strategyVersions.id, {
      onDelete: 'set null'
    }),
    initialBankroll: real('initial_bankroll'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    metadataJson: text('metadata_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('sessions_state_idx').on(t.state)]
)

export const spins = sqliteTable(
  'spins',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    value: integer('value').notNull(),
    source: text('source').notNull(),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('spins_session_idx').on(t.sessionId)]
)

export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('decisions_session_idx').on(t.sessionId)]
)

export const bets = sqliteTable(
  'bets',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    decisionId: text('decision_id').references(() => decisions.id, { onDelete: 'set null' }),
    payloadJson: text('payload_json').notNull(),
    result: text('result'),
    placedAt: integer('placed_at', { mode: 'timestamp_ms' }),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' })
  },
  (t) => [index('bets_session_idx').on(t.sessionId)]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const importJobs = sqliteTable('import_jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  payloadJson: text('payload_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
})

export const errorEvents = sqliteTable(
  'error_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    level: text('level').notNull(),
    message: text('message').notNull(),
    stack: text('stack'),
    contextJson: text('context_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('error_events_session_idx').on(t.sessionId)]
)

export const screenshots = sqliteTable(
  'screenshots',
  {
    id: text('id').primaryKey(),
    errorEventId: text('error_event_id').references(() => errorEvents.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    path: text('path').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('screenshots_session_idx').on(t.sessionId)]
)
