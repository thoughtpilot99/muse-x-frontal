import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/muse", async (orig) => ({ ...(await orig<typeof import("@/lib/muse")>()), runStructured: vi.fn() }));

import { runStructured } from "@/lib/muse";
import { analyzeClient, createClient, digestMarkdown, importCampaigns, importSlackApi, importSlackFiles, importTranscripts, portfolio } from "@/lib/accounts";
import { buildSnippets, ungroundedSentences, verifyItems, type Snippet } from "@/lib/agents";
import { clients, db, messagesOf } from "@/lib/db";
import { computeFacts, type Facts } from "@/lib/metrics";
import { conversationsArea, engagementArea, relationshipArea, resultsArea, scoreRisk, type EvidenceResult } from "@/lib/risk";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { CALL_TXT, CALL_VTT, CAMPAIGN_CSV, CLIENT_INPUT, exportZip, NOW, USERS } from "./fixtures";

const ST = DEFAULT_SETTINGS;
const NO_EVIDENCE: EvidenceResult = { known: false, snippets: 0, items: [], unverified: [] };

function seedAcme() {
  const id = createClient(CLIENT_INPUT);
  importSlackFiles(id, [{ name: "acme-export.zip", data: exportZip() }]);
  importTranscripts(id, [{ name: "2026-09-12-acme-review.vtt", text: CALL_VTT }, { name: "2026-04-28-kickoff.txt", text: CALL_TXT }]);
  importCampaigns(id, CAMPAIGN_CSV);
  return id;
}

const EVIDENCE_REPLY = {
  items: [
    { category: "results_complaint", snippet_id: "S2", quote: "the meetings this month have been underwhelming", why: "Results below expectations." },
    { category: "competitor_or_inhouse", snippet_id: "S2", quote: "bring outbound in-house next quarter", why: "Considering in-house." },
    { category: "champion_change", snippet_id: "S1", quote: "I'm taking over growth from Dana", why: "Main contact is handing over." },
  ],
};
const PLAN_REPLY = {
  why: "Meetings fell to 3 in the last 28 days against a target of 11, and Dana raised bringing outbound in-house. Renewal is in 30 days and a new owner, Sam Ortiz, is taking over.",
  plan: [
    { action: "Book an intro call with Sam Ortiz and walk through what is running.", owner: "account lead", within_days: 3 },
    { action: "Fix the booking rate: review the recent replies and change the offer.", owner: "GTM engineer", within_days: 7 },
    { action: "Send Dana a results plan before the renewal date.", owner: "founder", within_days: 7 },
  ],
  ask_on_next_call: ["What would a good month look like for Sam?"],
};

beforeEach(() => {
  db().exec("DELETE FROM clients; DELETE FROM events; DELETE FROM ai_runs; DELETE FROM settings;");
  vi.mocked(runStructured).mockReset();
  // Nothing may ever be sent anywhere: any network call fails the test.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))));
});
afterEach(() => vi.unstubAllGlobals());

describe("metrics", () => {
  it("computes results, engagement and relationship from the Acme fixture", () => {
    const id = seedAcme();
    const msgs = messagesOf(id);
    expect(msgs.filter((m) => m.side === "client")).toHaveLength(16);
    expect(msgs.filter((m) => m.side === "team").length).toBeGreaterThan(25);
    const f = computeFacts({
      client: { name: "Acme Robotics", monthly_fee: 8000, renewal_date: "2026-11-15", start_date: "2026-04-01", target_meetings: 12 },
      messages: msgs,
      calls: [{ date: "2026-09-12" }, { date: "2026-04-28" }],
      weeks: db().prepare("SELECT * FROM campaign_weeks WHERE client_id = ? ORDER BY week_start").all(id) as never,
      now: NOW,
    });
    expect(f.contract).toEqual({ monthlyFee: 8000, renewalDate: "2026-11-15", daysToRenewal: 30, tenureMonths: 6, targetMeetings: 12 });
    expect(f.results).toMatchObject({ known: true, metric: "meetings", last28: 3, prev28: 10, target28: 11, sentLast28: 3800, dataEnds: "2026-10-12" });
    expect(f.engagement).toEqual({ known: true, clientMsgsLast28: 2, clientMsgsPrev28: 6, teamMsgsLast28: 9, daysSinceClientMsg: 12, medianReplyHours: 38.8 });
    expect(f.relationship).toEqual({ known: true, mainContact: "Dana Lee", mainContactLast28: 1, mainContactBefore: 14, newVoices: ["Sam Ortiz"], callsLast28: 0, daysSinceCall: 33 });
  });
});

const base = (): Facts => ({
  client: "X",
  asOf: NOW.toISOString(),
  contract: { monthlyFee: null, renewalDate: null, daysToRenewal: null, tenureMonths: null, targetMeetings: null },
  results: { known: true, metric: "meetings", last28: 10, prev28: 10, target28: null, sentLast28: 0, repliesLast28: 0, dataEnds: "2026-10-12" },
  engagement: { known: true, clientMsgsLast28: 10, clientMsgsPrev28: 10, teamMsgsLast28: 10, daysSinceClientMsg: 2, medianReplyHours: 3 },
  relationship: { known: true, mainContact: "Dana", mainContactLast28: 5, mainContactBefore: 11, newVoices: [], callsLast28: 1, daysSinceCall: 10 },
});
const tweak = (fn: (f: Facts) => void) => {
  const f = base();
  fn(f);
  return f;
};

describe("risk rules", () => {
  it("results: vs target, else vs the 28 days before", () => {
    expect(resultsArea(tweak((f) => { f.results.last28 = 8; })).level).toBe("green");
    expect(resultsArea(tweak((f) => { f.results.last28 = 5; })).level).toBe("amber");
    expect(resultsArea(tweak((f) => { f.results.last28 = 4; })).level).toBe("red");
    expect(resultsArea(tweak((f) => { f.results.target28 = 4; f.results.last28 = 4; })).level).toBe("green");
    expect(resultsArea(tweak((f) => { f.results.prev28 = 0; f.results.last28 = 0; })).reason).toBe("No meetings in the last 56 days.");
    expect(resultsArea(tweak((f) => { f.results.known = false; })).level).toBe("unknown");
  });

  it("engagement: message trend and days of silence, whichever is worse", () => {
    const lvl = (last: number, quiet: number) => engagementArea(tweak((f) => { f.engagement.clientMsgsLast28 = last; f.engagement.daysSinceClientMsg = quiet; }), ST).level;
    expect(lvl(7, 2)).toBe("green");
    expect(lvl(4, 2)).toBe("amber");
    expect(lvl(3, 2)).toBe("red");
    expect(lvl(10, 11)).toBe("amber");
    expect(lvl(10, 22)).toBe("red");
  });

  it("relationship: the main contact going quiet, and long gaps between calls", () => {
    const lvl = (n: number, call = 10) => relationshipArea(tweak((f) => { f.relationship.mainContactLast28 = n; f.relationship.daysSinceCall = call; })).level;
    expect(lvl(3)).toBe("green");
    expect(lvl(2)).toBe("amber");
    expect(lvl(0)).toBe("red");
    expect(lvl(5, 46)).toBe("amber");
  });

  it("conversations: only recent evidence sets the colour", () => {
    const item = (category: string, date = "2026-10-01") => ({ category, snippetId: "S1", quote: "q", why: "w", date, source: "slack", author: null }) as never;
    const lvl = (items: never[]) => conversationsArea({ known: true, snippets: 5, items, unverified: [] }, NOW).level;
    expect(lvl([])).toBe("green");
    expect(lvl([item("positive_signal")])).toBe("green");
    expect(lvl([item("scope_or_priority_shift")])).toBe("amber");
    expect(lvl([item("results_complaint")])).toBe("amber");
    expect(lvl([item("results_complaint"), item("budget_or_cost")])).toBe("red");
    expect(lvl([item("champion_change")])).toBe("red");
    expect(lvl([item("champion_change", "2026-07-01")])).toBe("green");
    expect(conversationsArea(NO_EVIDENCE, NOW).level).toBe("unknown");
  });

  it("unknown areas are left out; under half the weight gives no score", () => {
    const r = scoreRisk(tweak((f) => { f.results.known = false; f.relationship.known = false; }), NO_EVIDENCE, ST, NOW);
    expect(r.coverage).toBe(0.25);
    expect(r.health).toBeNull();
    expect(r.status).toBe("Not enough data");
    const ok = scoreRisk(base(), { known: true, snippets: 3, items: [], unverified: [] }, ST, NOW);
    expect(ok).toMatchObject({ health: 100, status: "Healthy", urgent: false });
  });

  it("an at-risk account with a renewal soon is urgent", () => {
    const f = tweak((x) => { x.results.last28 = 2; x.contract.daysToRenewal = 20; });
    expect(scoreRisk(f, NO_EVIDENCE, ST, NOW)).toMatchObject({ status: "Watch", urgent: true });
  });
});

describe("grounding", () => {
  const snippets = new Map<string, Snippet>([["S1", { id: "S1", date: "2026-10-03", source: "slack", author: "Sam", text: "Hi all, I’m taking over growth from Dana starting next month." }]]);

  it("keeps only quotes copied word for word from the cited snippet", () => {
    const r = verifyItems([
      { category: "champion_change", snippet_id: "s1", quote: "I'm taking over growth from Dana", why: "" },
      { category: "champion_change", snippet_id: "S1", quote: "Dana is leaving the company", why: "" },
      { category: "budget_or_cost", snippet_id: "S9", quote: "taking over growth", why: "" },
      { category: "champion_change", snippet_id: "S1", quote: "I'm taking over growth from Dana", why: "dup" },
    ], snippets);
    expect(r.items.map((i) => i.quote)).toEqual(["I'm taking over growth from Dana"]);
    expect(r.bad).toHaveLength(2);
  });

  it("flags numbers that aren't in the facts", () => {
    const table = "F1 | Results | meetings last 28 days: 3; 28 days before: 10\nF2 | Contract | renewal in 30 days (2026-11-15)";
    expect(ungroundedSentences(["Meetings fell from 10 to 3. Renewal is on 2026-11-15, in 30 days."], table)).toEqual([]);
    expect(ungroundedSentences(["Meetings fell 70%.", "They pay 9000 a month."], table)).toEqual(["Meetings fell 70%.", "They pay 9000 a month."]);
  });

  it("sends Muse only the client's side, redacted, newest first", () => {
    const s = buildSnippets({
      messages: [
        { ts: "2026-10-01T10:00:00Z", author: "Priya Shah", side: "team", text: "Our update" },
        { ts: "2026-10-02T10:00:00Z", author: "Dana Lee", side: "client", text: "Call me at +1 415 555 0134" },
        { ts: "2026-05-01T10:00:00Z", author: "Dana Lee", side: "client", text: "Too old" },
      ],
      calls: [{ date: "2026-09-12", title: "Review", lines: [{ speaker: "Priya Shah", text: "Hi" }, { speaker: "Dana Lee", text: "Budget is tight." }] }],
      teamNames: ["Priya Shah"],
      now: NOW,
      lookbackDays: 90,
    });
    expect(s.map((x) => [x.id, x.source, x.author, x.text])).toEqual([
      ["S1", "slack", "Dana Lee", "Call me at [phone]"],
      ["S2", "call", "Dana Lee", "Budget is tight."],
    ]);
  });
});

describe("full analysis (Muse mocked)", () => {
  it("reads the conversations, scores the account, writes a save plan and stores the run", async () => {
    const id = seedAcme();
    vi.mocked(runStructured)
      // First evidence answer has one quote that isn't in the snippet: it triggers one retry.
      .mockResolvedValueOnce({ items: [...EVIDENCE_REPLY.items, { category: "budget_or_cost", snippet_id: "S2", quote: "they want to cut the budget by half", why: "" }] })
      .mockResolvedValueOnce(EVIDENCE_REPLY)
      .mockResolvedValueOnce(PLAN_REPLY);
    const v = await analyzeClient(id, { now: NOW });

    expect(runStructured).toHaveBeenCalledTimes(3);
    const evidencePrompt = String(vi.mocked(runStructured).mock.calls[0][0].user);
    expect(evidencePrompt).toContain("[S1] 2026-10-03 · Slack · Sam Ortiz: Hi all, I'm taking over growth from Dana");
    expect(evidencePrompt).toContain("[phone]");
    expect(evidencePrompt).not.toMatch(/415 555|Weekly update|Thanks for joining/);
    expect(String(vi.mocked(runStructured).mock.calls[1][0].user)).toContain("they want to cut the budget by half");

    expect(v.evidence.items.map((i) => i.category)).toEqual(["results_complaint", "competitor_or_inhouse", "champion_change"]);
    expect(v.evidence.unverified).toEqual([]);
    expect(v.risk.areas.map((a) => [a.key, a.level])).toEqual([["results", "red"], ["engagement", "red"], ["relationship", "amber"], ["conversations", "red"]]);
    expect(v.risk).toMatchObject({ health: 8, status: "At risk", urgent: true });
    expect(v.explanation?.plan).toHaveLength(3);
    expect(v.explanation?.unverified).toEqual([]);
    expect(String(vi.mocked(runStructured).mock.calls[2][0].user)).toContain('"bring outbound in-house next quarter"');

    const md = digestMarkdown(portfolio(clients()), NOW);
    expect(md).toContain("## Acme Robotics: At risk (8/100), renewal in 30 days");
    expect(md).toContain('- "the meetings this month have been underwhelming" (slack, 2026-09-20)');
    expect(md).toContain("1. Book an intro call with Sam Ortiz");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still scores the account without Muse, and shows what changed since last time", async () => {
    vi.stubEnv("MODEL_API_KEY", "");
    const id = seedAcme();
    const first = await analyzeClient(id, { now: new Date("2026-09-15T12:00:00Z") });
    const second = await analyzeClient(id, { now: NOW });
    expect(runStructured).not.toHaveBeenCalled();
    expect(second.risk.areas.find((a) => a.key === "conversations")?.level).toBe("unknown");
    expect(first.risk.health).toBeGreaterThan(second.risk.health ?? 0);
    expect(second.changes.join(" ")).toMatch(/Health down from \d+ to \d+\./);
    vi.unstubAllEnvs();
  });

  it("orders the portfolio most at risk first", async () => {
    vi.stubEnv("MODEL_API_KEY", "");
    const healthy = createClient({ ...CLIENT_INPUT, name: "Beta Health", renewalDate: "" });
    importCampaigns(healthy, ["date,meetings", "2026-09-14,3", "2026-09-21,3", "2026-09-28,3", "2026-10-05,3", "2026-10-12,3"].join("\n"));
    await analyzeClient(healthy, { now: NOW });
    const acme = seedAcme();
    await analyzeClient(acme, { now: NOW });
    expect(portfolio(clients()).map((r) => r.client.name)).toEqual(["Acme Robotics", "Beta Health"]);
    vi.unstubAllEnvs();
  });
});

describe("Slack API import", () => {
  it("only reads: history, replies and user lookups, never posts", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    const id = createClient(CLIENT_INPUT);
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      const method = new URL(url).pathname.split("/").pop();
      const body =
        method === "conversations.history"
          ? { ok: true, messages: [{ type: "message", user: "UDANA", text: "Can we talk about results?", ts: "1791800000.000100", reply_count: 1 }] }
          : method === "conversations.replies"
            ? { ok: true, messages: [{ ts: "1791800000.000100" }, { type: "message", user: "USAM", text: "Following.", ts: "1791800100.000200" }] }
            : { ok: true, user: USERS.find((u) => url.includes(u.id)) };
      return new Response(JSON.stringify(body));
    }));
    expect(await importSlackApi(id)).toBe("Read 2 message(s) from Slack, 2 new.");
    expect(urls.every((u) => /\/api\/(conversations\.history|conversations\.replies|users\.info)\?/.test(u))).toBe(true);
    expect(messagesOf(id).map((m) => [m.author, m.side])).toEqual([["Dana Lee", "client"], ["Sam Ortiz", "client"]]);
    vi.unstubAllEnvs();
  });
});
