import type { Facts } from "./metrics";
import type { Settings } from "./settings";

// Plain, written-down rules (also in the README), so anyone can check why an account got its
// colour. Missing data is "unknown": it is left out of the score and never counts as risk.

export const CATEGORIES = ["results_complaint", "budget_or_cost", "competitor_or_inhouse", "champion_change", "scope_or_priority_shift", "positive_signal"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  results_complaint: "Unhappy with results",
  budget_or_cost: "Budget or cost pressure",
  competitor_or_inhouse: "Considering another agency or bringing it in-house",
  champion_change: "Main contact leaving or changing role",
  scope_or_priority_shift: "Priorities or scope changing",
  positive_signal: "Positive signal",
};

export type EvidenceItem = { category: Category; snippetId: string; quote: string; why: string; date: string; source: "slack" | "call"; author: string | null };
export type EvidenceResult = { known: boolean; snippets: number; items: EvidenceItem[]; unverified: string[] };

export type Level = "green" | "amber" | "red" | "unknown";
export type AreaKey = "results" | "engagement" | "relationship" | "conversations";
export type Area = { key: AreaKey; label: string; weight: number; level: Level; reason: string };
export type RiskResult = { areas: Area[]; health: number | null; coverage: number; status: "Healthy" | "Watch" | "At risk" | "Not enough data"; urgent: boolean };

export const WEIGHTS: Record<AreaKey, number> = { results: 30, engagement: 25, relationship: 15, conversations: 30 };
const POINTS = { green: 100, amber: 50, red: 0 } as const;
const RANK: Record<Level, number> = { unknown: -1, green: 0, amber: 1, red: 2 };
const worst = (...ls: Level[]): Level => ls.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "green");
const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Evidence older than this doesn't set the colour (it still shows in the history). */
export const EVIDENCE_DAYS = 45;

export function resultsArea(f: Facts): Area {
  const base = { key: "results" as const, label: "Results", weight: WEIGHTS.results };
  const r = f.results;
  if (!r.known) {
    return { ...base, level: "unknown", reason: r.dataEnds ? `Campaign data ends ${r.dataEnds}; upload a recent export.` : "No campaign data uploaded." };
  }
  const what = r.metric;
  const against = r.target28 !== null ? { n: r.target28, label: "the contract target" } : { n: r.prev28, label: "the 28 days before" };
  if (against.n === 0) {
    return r.last28 > 0
      ? { ...base, level: "green", reason: `${r.last28} ${what} in the last 28 days, up from 0.` }
      : { ...base, level: "red", reason: `No ${what} in the last 56 days.` };
  }
  const ratio = r.last28 / against.n;
  const level: Level = ratio >= 0.8 ? "green" : ratio >= 0.5 ? "amber" : "red";
  return { ...base, level, reason: `${r.last28} ${what} in the last 28 days vs ${against.n} for ${against.label} (${pct(ratio)}).` };
}

export function engagementArea(f: Facts, st: Pick<Settings, "quietDaysAmber" | "quietDaysRed">): Area {
  const base = { key: "engagement" as const, label: "Engagement", weight: WEIGHTS.engagement };
  const e = f.engagement;
  if (!e.known) return { ...base, level: "unknown", reason: "No client messages imported." };
  const quiet: Level = e.daysSinceClientMsg === null ? "green" : e.daysSinceClientMsg > st.quietDaysRed ? "red" : e.daysSinceClientMsg > st.quietDaysAmber ? "amber" : "green";
  let trend: Level = "green";
  let trendText = `${s(e.clientMsgsLast28, "client message")} in the last 28 days`;
  if (e.clientMsgsPrev28 > 0) {
    const ratio = e.clientMsgsLast28 / e.clientMsgsPrev28;
    trend = ratio >= 0.7 ? "green" : ratio >= 0.4 ? "amber" : "red";
    trendText += ` vs ${e.clientMsgsPrev28} before (${pct(ratio)})`;
  }
  const parts = [`${trendText}.`];
  if (e.daysSinceClientMsg !== null) parts.push(`Last client message ${s(e.daysSinceClientMsg, "day")} ago.`);
  if (e.medianReplyHours !== null) parts.push(`Typical reply time ${e.medianReplyHours}h.`);
  return { ...base, level: worst(quiet, trend), reason: parts.join(" ") };
}

export function relationshipArea(f: Facts): Area {
  const base = { key: "relationship" as const, label: "Relationship", weight: WEIGHTS.relationship };
  const r = f.relationship;
  if (!r.known) return { ...base, level: "unknown", reason: "Not enough history to know who the main contact is, and no calls imported." };
  const parts: string[] = [];
  let contact: Level = "green";
  if (r.mainContact) {
    // The "before" window is 62 days long; scale it to 28 to compare like with like.
    const usual = (r.mainContactBefore * 28) / 62;
    const ratio = usual ? r.mainContactLast28 / usual : 1;
    contact = r.mainContactLast28 === 0 ? "red" : ratio < 0.5 ? "amber" : "green";
    parts.push(r.mainContactLast28 === 0 ? `${r.mainContact}, the main contact, has not written in 28 days.` : `${r.mainContact}, the main contact, wrote ${s(r.mainContactLast28, "message")} in the last 28 days.`);
  }
  if (r.newVoices.length) parts.push(`New on the client side: ${r.newVoices.join(", ")}.`);
  const calls: Level = r.daysSinceCall === null ? "green" : r.daysSinceCall > 45 ? "amber" : "green";
  if (r.daysSinceCall !== null) parts.push(`Last call ${s(r.daysSinceCall, "day")} ago.`);
  return { ...base, level: worst(contact, calls), reason: parts.join(" ") };
}

export function conversationsArea(ev: EvidenceResult, now: Date): Area {
  const base = { key: "conversations" as const, label: "Conversations", weight: WEIGHTS.conversations };
  if (!ev.known) return { ...base, level: "unknown", reason: "Not read yet: connect Muse Wonder and import Slack or calls." };
  const since = now.getTime() - EVIDENCE_DAYS * 86_400_000;
  const recent = ev.items.filter((i) => Date.parse(i.date) >= since && i.category !== "positive_signal");
  const count = (c: Category) => recent.filter((i) => i.category === c).length;
  const level: Level =
    count("champion_change") || count("competitor_or_inhouse") || count("results_complaint") + count("budget_or_cost") >= 2
      ? "red"
      : recent.length
        ? "amber"
        : "green";
  const groups = [...new Set(recent.map((i) => i.category))].map((c) => `${CATEGORY_LABEL[c]} (${count(c)})`);
  const positives = ev.items.filter((i) => i.category === "positive_signal" && Date.parse(i.date) >= since).length;
  const reason = groups.length
    ? `In the last ${EVIDENCE_DAYS} days: ${groups.join("; ")}.`
    : `No warning signs in the last ${EVIDENCE_DAYS} days${positives ? `; ${s(positives, "positive signal")}` : ""}.`;
  return { ...base, level, reason };
}

export function scoreRisk(f: Facts, ev: EvidenceResult, st: Pick<Settings, "quietDaysAmber" | "quietDaysRed" | "renewalUrgentDays">, now: Date): RiskResult {
  const areas = [resultsArea(f), engagementArea(f, st), relationshipArea(f), conversationsArea(ev, now)];
  const known = areas.filter((a) => a.level !== "unknown");
  const weight = known.reduce((n, a) => n + a.weight, 0);
  const coverage = weight / 100;
  const health = coverage < 0.5 ? null : Math.round(known.reduce((n, a) => n + a.weight * POINTS[a.level as keyof typeof POINTS], 0) / weight);
  const status = health === null ? "Not enough data" : health >= 75 ? "Healthy" : health >= 50 ? "Watch" : "At risk";
  const d = f.contract.daysToRenewal;
  const urgent = health !== null && health < 75 && d !== null && d >= 0 && d <= st.renewalUrgentDays;
  return { areas, health, coverage, status, urgent };
}

/** What moved since the previous analysis, for the weekly digest. */
export function changesSince(prev: RiskResult | null, cur: RiskResult): string[] {
  if (!prev) return [];
  const out: string[] = [];
  if (prev.health !== null && cur.health !== null && prev.health !== cur.health) {
    out.push(`Health ${cur.health > prev.health ? "up" : "down"} from ${prev.health} to ${cur.health}.`);
  }
  for (const a of cur.areas) {
    const b = prev.areas.find((x) => x.key === a.key);
    if (b && b.level !== a.level) out.push(`${a.label}: ${b.level} to ${a.level}.`);
  }
  return out;
}
