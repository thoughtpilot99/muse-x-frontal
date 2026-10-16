import type { Client, Side } from "../db";

// Slack is where an agency's clients actually talk. Two ways in: the workspace export
// (Settings -> Import/export data, a ZIP of one folder per channel with a JSON file per day),
// or a read-only bot token (channels:history, users:read, users:read.email).

export type RawMessage = { ts: string; author: string; email: string | null; text: string };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

type User = { name: string; email: string | null };

function userMap(list: unknown): Map<string, User> {
  const m = new Map<string, User>();
  for (const u of Array.isArray(list) ? list.filter(isObj) : []) {
    const p = isObj(u.profile) ? u.profile : {};
    m.set(str(u.id), {
      name: str(p.real_name) || str(p.display_name) || str(u.real_name) || str(u.name) || "Unknown",
      email: str(p.email) || null,
    });
  }
  return m;
}

/** Slack markup to plain text: <@U1> -> @Name, <url|label> -> label, entities decoded. */
export function cleanText(text: string, users: Map<string, User>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${users.get(id)?.name ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

const SKIP_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name", "bot_message", "pinned_item", "channel_archive"]);

export function toRaw(m: Json, users: Map<string, User>): RawMessage | null {
  if (SKIP_SUBTYPES.has(str(m.subtype)) || m.bot_id || !str(m.text).trim()) return null;
  const seconds = Number(str(m.ts));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const profile = isObj(m.user_profile) ? m.user_profile : {};
  const u = users.get(str(m.user));
  return {
    ts: new Date(seconds * 1000).toISOString(),
    author: u?.name ?? (str(profile.real_name) || str(profile.display_name) || str(m.user) || "Unknown"),
    email: u?.email ?? null,
    text: cleanText(str(m.text), users),
  };
}

/** Channels in an export: the folder names that contain day files. */
export function exportChannels(files: { name: string }[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    const m = f.name.match(/(?:^|\/)([^/]+)\/\d{4}-\d{2}-\d{2}\.json$/);
    if (m) set.add(m[1]);
  }
  return [...set].sort();
}

export function parseSlackExport(files: { name: string; text: string }[], channel?: string): { channel: string; messages: RawMessage[] } {
  const parse = (t: string): unknown => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  const usersFile = files.find((f) => /(?:^|\/)users\.json$/.test(f.name));
  const users = userMap(usersFile ? parse(usersFile.text) : []);
  const channels = exportChannels(files);
  const chosen = channel?.trim() || (channels.length === 1 ? channels[0] : "");
  if (!chosen) {
    throw new Error(channels.length ? `This export has ${channels.length} channels. Pick one: ${channels.join(", ")}.` : "No channel day files (channel/YYYY-MM-DD.json) found in the export.");
  }
  if (!channels.includes(chosen)) throw new Error(`Channel "${chosen}" is not in this export. Channels: ${channels.join(", ")}.`);
  const messages: RawMessage[] = [];
  for (const f of files) {
    const m = f.name.match(/(?:^|\/)([^/]+)\/\d{4}-\d{2}-\d{2}\.json$/);
    if (m?.[1] !== chosen) continue;
    const day = parse(f.text);
    for (const raw of Array.isArray(day) ? day.filter(isObj) : []) {
      const msg = toRaw(raw, users);
      if (msg) messages.push(msg);
    }
  }
  return { channel: chosen, messages: messages.sort((a, b) => a.ts.localeCompare(b.ts)) };
}

const domainOf = (email: string | null) => email?.split("@")[1]?.toLowerCase() ?? null;

/** Who said it: your team, the client, or unknown. Emails win; names are the fallback. */
export function sideOf(m: { author: string; email: string | null }, c: Pick<Client, "team_domains" | "client_domains" | "team_names">): Side {
  const team = (JSON.parse(c.team_domains) as string[]).map((d) => d.toLowerCase());
  const theirs = (JSON.parse(c.client_domains) as string[]).map((d) => d.toLowerCase());
  const names = (JSON.parse(c.team_names) as string[]).map((n) => n.toLowerCase().trim()).filter(Boolean);
  const d = domainOf(m.email);
  if (d && team.some((t) => d === t || d.endsWith(`.${t}`))) return "team";
  if (d && theirs.some((t) => d === t || d.endsWith(`.${t}`))) return "client";
  if (names.includes(m.author.toLowerCase().trim())) return "team";
  // In a shared channel, anyone with an email outside your domains is on the client's side.
  if (d && team.length) return "client";
  return "unknown";
}

/** Read-only import with a bot token. Never posts: only history, replies and user lookups. */
export async function fetchSlackChannel(token: string, channel: string, oldestDays: number): Promise<RawMessage[]> {
  const call = async (method: string, params: Record<string, string>) => {
    const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as Json;
    if (!body.ok) throw new Error(`Slack ${method} failed: ${str(body.error) || res.status}`);
    return body;
  };
  const oldest = String(Math.floor(Date.now() / 1000 - oldestDays * 86_400));
  const raw: Json[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const body = await call("conversations.history", { channel, oldest, limit: "200", ...(cursor ? { cursor } : {}) });
    const list = Array.isArray(body.messages) ? body.messages.filter(isObj) : [];
    raw.push(...list);
    cursor = str(isObj(body.response_metadata) ? body.response_metadata.next_cursor : "");
    if (!cursor) break;
  }
  // Thread replies are where most client feedback lives.
  for (const parent of raw.filter((m) => Number(m.reply_count) > 0).slice(0, 100)) {
    const body = await call("conversations.replies", { channel, ts: str(parent.ts), limit: "200" });
    const replies = Array.isArray(body.messages) ? body.messages.filter(isObj) : [];
    raw.push(...replies.filter((r) => str(r.ts) !== str(parent.ts)));
  }
  const users = new Map<string, User>();
  for (const id of new Set(raw.map((m) => str(m.user)).filter(Boolean))) {
    try {
      const body = await call("users.info", { user: id });
      users.set(id, userMap([body.user]).get(id) ?? { name: id, email: null });
    } catch {
      users.set(id, { name: id, email: null });
    }
  }
  return raw.map((m) => toRaw(m, users)).filter((m): m is RawMessage => !!m).sort((a, b) => a.ts.localeCompare(b.ts));
}
