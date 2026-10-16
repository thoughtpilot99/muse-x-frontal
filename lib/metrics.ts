import type { CampaignWeek, Client, Side } from "./db";

// Everything measurable about an account, computed in plain code from what was imported.
// Windows are the 28 days before the analysis ("last") and the 28 days before that ("prev").

export type Msg = { ts: string; author: string; side: Side };
export type CallRow = { date: string };

export type Facts = {
  client: string;
  asOf: string;
  contract: { monthlyFee: number | null; renewalDate: string | null; daysToRenewal: number | null; tenureMonths: number | null; targetMeetings: number | null };
  results: {
    known: boolean;
    metric: "meetings" | "positive replies";
    last28: number;
    prev28: number;
    target28: number | null;
    sentLast28: number;
    repliesLast28: number;
    dataEnds: string | null;
  };
  engagement: { known: boolean; clientMsgsLast28: number; clientMsgsPrev28: number; teamMsgsLast28: number; daysSinceClientMsg: number | null; medianReplyHours: number | null };
  relationship: {
    known: boolean;
    mainContact: string | null;
    mainContactLast28: number;
    mainContactBefore: number; // in the 62 days before the last 28
    newVoices: string[];
    callsLast28: number;
    daysSinceCall: number | null;
  };
};

const DAY = 86_400_000;
const daysBetween = (a: number, b: number) => Math.floor((b - a) / DAY);
const round1 = (n: number) => Math.round(n * 10) / 10;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeFacts(input: {
  client: Pick<Client, "name" | "monthly_fee" | "renewal_date" | "start_date" | "target_meetings">;
  messages: Msg[];
  calls: CallRow[];
  weeks: CampaignWeek[];
  now: Date;
}): Facts {
  const now = input.now.getTime();
  const last = now - 28 * DAY;
  const prev = now - 56 * DAY;
  const c = input.client;

  // Contract
  const renewal = c.renewal_date ? Date.parse(c.renewal_date) : NaN;
  const start = c.start_date ? Date.parse(c.start_date) : NaN;
  const contract = {
    monthlyFee: c.monthly_fee ?? null,
    renewalDate: c.renewal_date ?? null,
    daysToRenewal: Number.isFinite(renewal) ? daysBetween(now, renewal) : null,
    tenureMonths: Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / (30.44 * DAY))) : null,
    targetMeetings: c.target_meetings ?? null,
  };

  // Results: meetings if the export has them, otherwise positive replies.
  // Only what had happened by the analysis date counts (re-running an older date stays honest).
  const weeks = input.weeks.filter((w) => Date.parse(w.week_start) < now);
  const metric: Facts["results"]["metric"] = weeks.some((w) => w.meetings > 0) || !weeks.some((w) => w.positive > 0) ? "meetings" : "positive replies";
  const value = (w: CampaignWeek) => (metric === "meetings" ? w.meetings : w.positive);
  const inLast = (w: CampaignWeek) => Date.parse(w.week_start) >= last && Date.parse(w.week_start) < now;
  const inPrev = (w: CampaignWeek) => Date.parse(w.week_start) >= prev && Date.parse(w.week_start) < last;
  const dataEnds = weeks.length ? weeks[weeks.length - 1].week_start : null;
  // Stale exports aren't evidence of a bad month: data must reach into the last two weeks.
  const fresh = !!dataEnds && Date.parse(dataEnds) >= now - 14 * DAY;
  const results = {
    known: fresh,
    metric,
    last28: weeks.filter(inLast).reduce((n, w) => n + value(w), 0),
    prev28: weeks.filter(inPrev).reduce((n, w) => n + value(w), 0),
    target28: metric === "meetings" && c.target_meetings ? round1((c.target_meetings * 28) / 30.44) : null,
    sentLast28: weeks.filter(inLast).reduce((n, w) => n + w.sent, 0),
    repliesLast28: weeks.filter(inLast).reduce((n, w) => n + w.replies, 0),
    dataEnds,
  };

  // Engagement: how much and how fast the client talks to you.
  const t = (m: Msg) => Date.parse(m.ts);
  const msgs = input.messages.filter((m) => t(m) <= now).sort((a, b) => a.ts.localeCompare(b.ts));
  const client = msgs.filter((m) => m.side === "client");
  const lastClient = client.at(-1);
  const replyHours: number[] = [];
  for (let i = 1; i < msgs.length; i++) {
    const m = msgs[i];
    const before = msgs[i - 1];
    if (m.side === "client" && before.side === "team" && t(m) >= last) {
      replyHours.push(Math.min(168, (t(m) - t(before)) / 3_600_000));
    }
  }
  const engagement = {
    known: client.length > 0,
    clientMsgsLast28: client.filter((m) => t(m) >= last && t(m) < now).length,
    clientMsgsPrev28: client.filter((m) => t(m) >= prev && t(m) < last).length,
    teamMsgsLast28: msgs.filter((m) => m.side === "team" && t(m) >= last && t(m) < now).length,
    daysSinceClientMsg: lastClient ? daysBetween(t(lastClient), now) : null,
    medianReplyHours: (() => {
      const m = median(replyHours);
      return m === null ? null : round1(m);
    })(),
  };

  // Relationship: is the person who used to talk to you still talking?
  const before = client.filter((m) => t(m) >= now - 90 * DAY && t(m) < last);
  const counts = new Map<string, number>();
  for (const m of before) counts.set(m.author, (counts.get(m.author) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1])[0];
  const everBefore = new Set(client.filter((m) => t(m) < last).map((m) => m.author));
  const calls = input.calls.map((x) => Date.parse(x.date)).filter((x) => Number.isFinite(x) && x <= now).sort((a, b) => a - b);
  const relationship = {
    known: (!!main && main[1] >= 3) || calls.length > 0,
    mainContact: main && main[1] >= 3 ? main[0] : null,
    mainContactLast28: main ? client.filter((m) => m.author === main[0] && t(m) >= last).length : 0,
    mainContactBefore: main ? main[1] : 0,
    newVoices: [...new Set(client.filter((m) => t(m) >= last && !everBefore.has(m.author)).map((m) => m.author))],
    callsLast28: calls.filter((x) => x >= last).length,
    daysSinceCall: calls.length ? daysBetween(calls[calls.length - 1], now) : null,
  };

  return { client: c.name, asOf: input.now.toISOString(), contract, results, engagement, relationship };
}
