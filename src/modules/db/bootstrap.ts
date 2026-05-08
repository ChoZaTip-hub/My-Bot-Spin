import type Database from 'better-sqlite3'

const DDL = `
CREATE TABLE IF NOT EXISTS strategies (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_versions (
  id text PRIMARY KEY NOT NULL,
  strategy_id text NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  config_json text NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS strategy_versions_strategy_idx ON strategy_versions (strategy_id);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY NOT NULL,
  mode text NOT NULL,
  state text NOT NULL,
  strategy_version_id text REFERENCES strategy_versions(id) ON DELETE SET NULL,
  initial_bankroll real,
  started_at integer NOT NULL,
  ended_at integer,
  metadata_json text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_state_idx ON sessions (state);
CREATE TABLE IF NOT EXISTS spins (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  value integer NOT NULL,
  source text NOT NULL,
  observed_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS spins_session_idx ON spins (session_id);
CREATE TABLE IF NOT EXISTS decisions (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  payload_json text NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_session_idx ON decisions (session_id);
CREATE TABLE IF NOT EXISTS bets (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  decision_id text REFERENCES decisions(id) ON DELETE SET NULL,
  payload_json text NOT NULL,
  result text,
  placed_at integer,
  resolved_at integer
);
CREATE INDEX IF NOT EXISTS bets_session_idx ON bets (session_id);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY NOT NULL,
  value_json text NOT NULL,
  updated_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  payload_json text,
  created_at integer NOT NULL,
  finished_at integer
);
CREATE TABLE IF NOT EXISTS error_events (
  id text PRIMARY KEY NOT NULL,
  session_id text REFERENCES sessions(id) ON DELETE SET NULL,
  level text NOT NULL,
  message text NOT NULL,
  stack text,
  context_json text,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS error_events_session_idx ON error_events (session_id);
CREATE TABLE IF NOT EXISTS screenshots (
  id text PRIMARY KEY NOT NULL,
  error_event_id text REFERENCES error_events(id) ON DELETE CASCADE,
  session_id text REFERENCES sessions(id) ON DELETE SET NULL,
  path text NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS screenshots_session_idx ON screenshots (session_id);
`

export function bootstrapSqliteSchema(sqlite: Database.Database): void {
  sqlite.exec(DDL)
}
