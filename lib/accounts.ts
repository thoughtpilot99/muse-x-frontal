import { buildSnippets, explainRisk, findEvidence, type Explanation } from "./agents";
import { config } from "./config";
import {
  callsOf, getClient, latestRun, logEvent, messagesOf, parseJson, run, runsOf, weeksOf, type Client, type Run,
} from "./db";
import { computeFacts, type Facts } from "./metrics";
import { changesSince, scoreRisk, type EvidenceResult, type RiskResult } from "./risk";
import { getSettings } from "./settings";
import { parseCampaignCsv } from "./sources/campaigns";
import { fetchSlackChannel, parseSlackExport, sideOf, type RawMessage } from "./sources/slack";
import { parseTranscript, storedLines, transcriptText } from "./sources/transcripts";
import { readZip } from "./sources/zip";

const list = (s: string) => [...new Set(s.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean))];
const domains = (s: string) => list(s).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^@/, "").replace(/\/.*$/, ""));
const date = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null);
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};

export type ClientInput = {
  name: string; teamDomains: string; clientDomains: string; teamNames: string;
  monthlyFee: string; startDate: string; renewalDate: string; targetMeetings: string; slackChannel: string; notes: string;
};

function clientFields(i: ClientInput) {
  if (!i.name.trim()) throw new Error("Give the client a name.");
  return [
    i.name.trim().slice(0, 120), JSON.stringify(domains(i.teamDomains)), JSON.stringify(domains(i.clientDomains)), JSON.stringify(list(i.teamNames)),
    num(i.monthlyFee), date(i.startDate), date(i.renewalDate), num(i.targetMeetings), i.slackChannel.trim() || null, i.notes.trim().slice(0, 2000),
  ] as const;
}

export function createClient(i: ClientInput): number {
  const r = run(
    `INSERT INTO clients (name, team_domains, client_domains, team_names, monthly_fee, start_date, renewal_date, target_meetings, slack_channel, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...clientFields(i),
  );
  return Number(r.lastInsertRowid);
}

export function editClient(id: number, i: ClientInput) {
  run(
    `UPDATE clients SET name = ?, team_domains = ?, client_domains = ?, team_names = ?, monthly_fee = ?, start_date = ?, renewal_date = ?,
     target_meetings = ?, slack_channel = ?, notes = ? WHERE id = ?`,
    ...clientFields(i), id,
  );
  // Who counts as "team" may have changed: re-label stored messages.
  relabel(getClient(id)!);
}

function relabel(c: Client) {
  for (const m of messagesOf(c.id)) {
    const side = sideOf(m, c);
    if (side !== m.side) run("UPDATE messages SET side = ? WHERE id = ?", side, m.id);
  }
}

function saveMessages(c: Client, msgs: RawMessage[]): number {
  let added = 0;
  for (const m of msgs) {
    const r = run(
      "INSERT OR IGNORE INTO messages (client_id, ts, author, email, side, text) VALUES (?, ?, ?, ?, ?, ?)",
      c.id, m.ts, m.author.slice(0, 120), m.email, sideOf(m, c), m.text.slice(0, 8000),
    );
    added += Number(r.changes);
  }
  return added;
}

const sideCounts = (id: number) => {
  const ms = messagesOf(id);
  return { client: ms.filter((m) => m.side === "client").length, team: ms.filter((m) => m.side === "team").length, unknown: ms.filter((m) => m.side === "unknown").length };
};

/** A Slack export: the ZIP itself, or the channel's day files (plus users.json) uploaded together. */
export function importSlackFiles(clientId: number, files: { name: string; data: Buffer }[], channel?: string): string {
  const c = getClient(clientId);
  if (!c) throw new Error("Client not found.");
  const entries = files.flatMap((f) =>
    /\.zip$/i.test(f.name) ? readZip(f.data, (n) => n.endsWith(".json")) : [{ name: f.name.includes("/") ? f.name : `${channel || "channel"}/${f.name}`, text: f.data.toString("utf8") }],
  );
  // Loose day files were given a folder name above; users.json keeps its own name.
  const fixed = entries.map((e) => (/(^|\/)users\.json$/.test(e.name) ? { ...e, name: "users.json" } : e));
  const parsed = parseSlackExport(fixed, channel);
  const added = saveMessages(c, parsed.messages);
  const n = sideCounts(c.id);
  return `Imported ${added} new message(s) from #${parsed.channel}. Stored: ${n.client} from the client, ${n.team} from your team, ${n.unknown} unknown${n.unknown ? " (add team domains or names to sort them)" : ""}.`;
}

/** Read-only Slack API import (history, thread replies, user lookups). Never posts. */
export async function importSlackApi(clientId: number): Promise<string> {
  const c = getClient(clientId);
  if (!c) throw new Error("Client not found.");
  if (!config.slackToken()) throw new Error("Add a Slack bot token on the Setup page first.");
  if (!c.slack_channel) throw new Error("Add the Slack channel ID (it starts with C) to this client first.");
  const msgs = await fetchSlackChannel(config.slackToken(), c.slack_channel, getSettings().lookbackDays);
  const added = saveMessages(c, msgs);
  logEvent({ source: "slack", kind: "conversations.history", ok: true, note: `${msgs.length} message(s) read, ${added} new` });
  return `Read ${msgs.length} message(s) from Slack, ${added} new.`;
}

export function importTranscripts(clientId: number, files: { name: string; text: string }[], fallbackDate?: string): string {
  if (!getClient(clientId)) throw new Error("Client not found.");
  const done: string[] = [];
  const missingDate: string[] = [];
  for (const f of files) {
    const t = parseTranscript(f.name, f.text);
    const d = t.date ?? date(fallbackDate ?? "");
    if (!d) {
      missingDate.push(f.name);
      continue;
    }
    if (!t.lines.length) continue;
    run(
      `INSERT INTO calls (client_id, date, title, text) VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id, date, title) DO UPDATE SET text = excluded.text`,
      clientId, d, t.title.slice(0, 200), transcriptText(t.lines).slice(0, 400_000),
    );
    done.push(`${t.title} (${d}, ${t.lines.length} lines)`);
  }
  if (missingDate.length && !done.length) throw new Error(`No date found for: ${missingDate.join(", ")}. Put the date in the file name (2026-10-01-call.txt) or fill in the date field.`);
  return `Imported ${done.length} call(s): ${done.join("; ")}.${missingDate.length ? ` Skipped (no date): ${missingDate.join(", ")}.` : ""}`;
}

export function importCampaigns(clientId: number, csv: string): string {
  if (!getClient(clientId)) throw new Error("Client not found.");
  const r = parseCampaignCsv(csv);
  for (const w of r.weeks) {
    run(
      `INSERT INTO campaign_weeks (client_id, week_start, sent, replies, positive, meetings) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, week_start) DO UPDATE SET sent = excluded.sent, replies = excluded.replies, positive = excluded.positive, meetings = excluded.meetings`,
      clientId, w.week_start, w.sent, w.replies, w.positive, w.meetings,
    );
  }
  const cols = Object.entries(r.mapped).map(([k, v]) => `${k} = "${v}"`).join(", ");
  return `Imported ${r.weeks.length} week(s) of results (${cols}).${r.skipped ? ` Skipped ${r.skipped} row(s) without a readable date.` : ""}`;
}

// ---------- Analysis ----------

export type RunView = Omit<Run, "facts" | "evidence" | "risk" | "explanation"> & {
  facts: Facts; evidence: EvidenceResult; risk: RiskResult; explanation: Explanation | null; changes: string[];
};

export function viewRun(r: Run, previous?: Run): RunView {
  const risk = parseJson<RiskResult>(r.risk, { areas: [], health: null, coverage: 0, status: "Not enough data", urgent: false });
  return {
    ...r,
    facts: parseJson<Facts>(r.facts, null as never),
    evidence: parseJson<EvidenceResult>(r.evidence, { known: false, snippets: 0, items: [], unverified: [] }),
    risk,
    explanation: parseJson<Explanation | null>(r.explanation, null),
    changes: previous ? changesSince(parseJson<RiskResult | null>(previous.risk, null), risk) : [],
  };
}

export function latestView(clientId: number): RunView | null {
  const [cur, prev] = runsOf(clientId, 2);
  return cur ? viewRun(cur, prev) : null;
}

export async function analyzeClient(clientId: number, opts: { now?: Date } = {}): Promise<RunView> {
  const c = getClient(clientId);
  if (!c) throw new Error("Client not found.");
  const now = opts.now ?? new Date();
  const st = getSettings();
  relabel(c);
  const messages = messagesOf(c.id);
  const calls = callsOf(c.id).map((x) => ({ date: x.date, title: x.title, lines: storedLines(x.text) }));
  const facts = computeFacts({ client: c, messages, calls, weeks: weeksOf(c.id), now });

  let evidence: EvidenceResult = { known: false, snippets: 0, items: [], unverified: [] };
  let explanation: Explanation | null = null;
  let error: string | null = null;
  const snippets = buildSnippets({ messages, calls, teamNames: JSON.parse(c.team_names), now, lookbackDays: st.lookbackDays });
  if (config.museApiKey() && snippets.length) {
    try {
      evidence = await findEvidence({ snippets, clientName: c.name, clientId: c.id });
    } catch (e) {
      error = `Reading the conversations failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const risk = scoreRisk(facts, evidence, st, now);
  if (config.museApiKey() && !error) {
    try {
      explanation = await explainRisk({ facts, risk, evidence, agency: st.agency, clientId: c.id });
    } catch (e) {
      error = `The save plan failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const previous = latestRun(c.id);
  const r = run(
    "INSERT INTO runs (client_id, facts, evidence, risk, explanation, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    c.id, JSON.stringify(facts), JSON.stringify(evidence), JSON.stringify(risk), explanation ? JSON.stringify(explanation) : null, error,
    now.toISOString().replace("T", " ").slice(0, 19),
  );
  const saved = runsOf(c.id, 1)[0];
  if (Number(r.lastInsertRowid) !== saved.id) throw new Error("Could not save the analysis.");
  return viewRun(saved, previous);
}

// ---------- Portfolio and weekly digest ----------

export type PortfolioRow = { client: Client; view: RunView | null };

export function portfolio(all: Client[]): PortfolioRow[] {
  const rows = all.map((client) => ({ client, view: latestView(client.id) }));
  // Most at risk first; urgent renewals before everything; unanalysed last.
  const key = (r: PortfolioRow) => (r.view?.risk.health ?? 1000) - (r.view?.risk.urgent ? 1000 : 0);
  return rows.sort((a, b) => key(a) - key(b));
}

export function digestMarkdown(rows: PortfolioRow[], now = new Date()): string {
  const out = [`# Churn Radar: weekly digest (${now.toISOString().slice(0, 10)})`, ""];
  for (const { client, view } of rows) {
    if (!view) {
      out.push(`## ${client.name}: not analysed yet`, "");
      continue;
    }
    const r = view.risk;
    out.push(`## ${client.name}: ${r.status}${r.health !== null ? ` (${r.health}/100)` : ""}${r.urgent ? `, renewal in ${view.facts.contract.daysToRenewal} days` : ""}`);
    if (view.explanation) out.push("", view.explanation.why);
    if (view.changes.length) out.push("", `Changed: ${view.changes.join(" ")}`);
    for (const a of r.areas) out.push(`- ${a.label} (${a.level}): ${a.reason}`);
    const quotes = view.evidence.items.filter((i) => i.category !== "positive_signal").slice(0, 3);
    for (const q of quotes) out.push(`- "${q.quote}" (${q.source}, ${q.date})`);
    if (view.explanation?.plan.length) {
      out.push("", "Save plan:");
      view.explanation.plan.forEach((p, i) => out.push(`${i + 1}. ${p.action} (${p.owner}, within ${p.within_days} days)`));
    }
    out.push("");
  }
  return out.join("\n");
}
