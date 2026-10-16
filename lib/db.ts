import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Side = "client" | "team" | "unknown";

export type Client = {
  id: number;
  name: string;
  team_domains: string; // JSON string[]: your agency's email domains, e.g. ["frontal.ai"]
  client_domains: string; // JSON string[]: the client's email domains
  team_names: string; // JSON string[]: your teammates' display names, for sources without emails
  monthly_fee: number | null;
  start_date: string | null; // YYYY-MM-DD
  renewal_date: string | null; // YYYY-MM-DD
  target_meetings: number | null; // per month, from the contract
  slack_channel: string | null; // channel id for the optional Slack API import
  notes: string;
  created_at: string;
};

export type Message = {
  id: number;
  client_id: number;
  ts: string; // ISO
  author: string;
  email: string | null;
  side: Side;
  text: string;
};

export type Call = { id: number; client_id: number; date: string; title: string; text: string; created_at: string };

export type CampaignWeek = {
  client_id: number;
  week_start: string; // Monday, YYYY-MM-DD
  sent: number;
  replies: number;
  positive: number;
  meetings: number;
};

export type Run = {
  id: number;
  client_id: number;
  facts: string; // JSON Facts
  evidence: string; // JSON EvidenceResult
  risk: string; // JSON RiskResult
  explanation: string | null; // JSON Explanation
  error: string | null;
  created_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  team_domains TEXT NOT NULL DEFAULT '[]',
  client_domains TEXT NOT NULL DEFAULT '[]',
  team_names TEXT NOT NULL DEFAULT '[]',
  monthly_fee REAL,
  start_date TEXT,
  renewal_date TEXT,
  target_meetings REAL,
  slack_channel TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  author TEXT NOT NULL,
  email TEXT,
  side TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (client_id, ts, author)
);
CREATE INDEX IF NOT EXISTS messages_client ON messages(client_id, ts);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, date, title)
);
CREATE TABLE IF NOT EXISTS campaign_weeks (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  sent REAL NOT NULL DEFAULT 0,
  replies REAL NOT NULL DEFAULT 0,
  positive REAL NOT NULL DEFAULT 0,
  meetings REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, week_start)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  facts TEXT NOT NULL,
  evidence TEXT NOT NULL,
  risk TEXT NOT NULL,
  explanation TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS runs_client ON runs(client_id, id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  note TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT NOT NULL,
  lead_id INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const g = globalThis as unknown as { __crDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__crDb) {
    const file = process.env.CR_DB_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    d.exec(SCHEMA);
    g.__crDb = d;
  }
  return g.__crDb;
}

export type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const getClient = (id: number) => get<Client>("SELECT * FROM clients WHERE id = ?", id);
export const clients = () => all<Client>("SELECT * FROM clients ORDER BY name");
export const messagesOf = (clientId: number) => all<Message>("SELECT * FROM messages WHERE client_id = ? ORDER BY ts", clientId);
export const callsOf = (clientId: number) => all<Call>("SELECT * FROM calls WHERE client_id = ? ORDER BY date", clientId);
export const weeksOf = (clientId: number) => all<CampaignWeek>("SELECT * FROM campaign_weeks WHERE client_id = ? ORDER BY week_start", clientId);
export const runsOf = (clientId: number, limit = 10) => all<Run>("SELECT * FROM runs WHERE client_id = ? ORDER BY id DESC LIMIT ?", clientId, limit);
export const latestRun = (clientId: number) => get<Run>("SELECT * FROM runs WHERE client_id = ? ORDER BY id DESC LIMIT 1", clientId);

const CLIENT_COLS = new Set(["name", "team_domains", "client_domains", "team_names", "monthly_fee", "start_date", "renewal_date", "target_meetings", "slack_channel", "notes"]);

export function updateClient(id: number, fields: Partial<Record<keyof Client, Param>>) {
  const keys = Object.keys(fields).filter((k) => CLIENT_COLS.has(k) && fields[k as keyof Client] !== undefined);
  if (!keys.length) return;
  run(`UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => fields[k as keyof Client] ?? null), id);
}

export function logEvent(e: { source: string; kind: string; ok: boolean; note?: string; payload?: string }) {
  run(
    "INSERT INTO events (source, kind, ok, note, payload) VALUES (?, ?, ?, ?, ?)",
    e.source, e.kind, e.ok ? 1 : 0, e.note ?? null, e.payload?.slice(0, 20_000) ?? null,
  );
}
