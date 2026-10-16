import { describe, expect, it } from "vitest";
import { parseCampaignCsv } from "@/lib/sources/campaigns";
import { exportChannels, parseSlackExport, sideOf } from "@/lib/sources/slack";
import { parseTranscript } from "@/lib/sources/transcripts";
import { readZip } from "@/lib/sources/zip";
import { redact } from "@/lib/redact";
import { CALL_TXT, CALL_VTT, CAMPAIGN_CSV, exportZip } from "./fixtures";

const CLIENT = { team_domains: '["agency.example"]', client_domains: '["acme.example"]', team_names: '["Priya Shah"]' };

describe("Slack export", () => {
  it("reads the ZIP, cleans Slack markup and skips joins and bots", () => {
    const entries = readZip(exportZip(), (n) => n.endsWith(".json"));
    expect(exportChannels(entries)).toEqual(["acme-shared"]);
    const { channel, messages } = parseSlackExport(entries);
    expect(channel).toBe("acme-shared");
    expect(messages.filter((m) => m.author === "Dana Lee")).toHaveLength(15);
    expect(messages.some((m) => m.text.includes("has joined") || m.text.includes("Instantly:"))).toBe(false);
    expect(messages[0].text).not.toContain("<@");
    expect(messages.find((m) => m.author === "Dana Lee")?.text).toBe("Thanks @Priya Shah, looks good. Let's keep the same sequence for the next batch.");
    expect(messages.find((m) => m.author === "Priya Shah")?.text).toBe("Weekly update: new batch is live, details in the doc here.");
    expect(messages.map((m) => m.ts)).toEqual([...messages.map((m) => m.ts)].sort());
  });

  it("asks which channel when the export has several", () => {
    const entries = readZip(exportZip(true));
    expect(() => parseSlackExport(entries)).toThrow(/2 channels. Pick one: acme-shared, general/);
    expect(parseSlackExport(entries, "general").messages).toHaveLength(1);
  });

  it("tells the client's side from yours by email domain, then by name", () => {
    expect(sideOf({ author: "Dana Lee", email: "dana@acme.example" }, CLIENT)).toBe("client");
    expect(sideOf({ author: "Priya Shah", email: "priya@agency.example" }, CLIENT)).toBe("team");
    expect(sideOf({ author: "Priya Shah", email: null }, CLIENT)).toBe("team");
    expect(sideOf({ author: "Jo", email: "jo@acme-holding.example" }, CLIENT)).toBe("client");
    expect(sideOf({ author: "Jo", email: null }, CLIENT)).toBe("unknown");
    expect(sideOf({ author: "Lee", email: "lee@eu.agency.example" }, CLIENT)).toBe("team");
  });

  it("rejects files that aren't ZIPs", () => {
    expect(() => readZip(Buffer.from("not a zip at all, just text............"))).toThrow(/not a ZIP/);
  });
});

describe("transcripts", () => {
  it("reads WebVTT voices and merges a speaker's consecutive cues", () => {
    const t = parseTranscript("2026-09-12-acme-review.vtt", CALL_VTT);
    expect(t.date).toBe("2026-09-12");
    expect(t.title).toBe("2026 09 12 acme review");
    expect(t.lines).toEqual([
      { speaker: "Priya Shah", text: "Thanks for joining, Dana." },
      { speaker: "Dana Lee", text: "The reply rates are fine but we need booked meetings, the board only cares about pipeline. If October doesn't pick up we will have to rethink the budget." },
    ]);
  });

  it("reads SRT, plain 'Name: text', Otter and Fathom styles", () => {
    const srt = parseTranscript("call.srt", "1\n00:00:01,000 --> 00:00:03,000\nDana Lee: We are pausing new hires.\n\n2\n00:00:04,000 --> 00:00:06,000\nPriya Shah: Understood.\n");
    expect(srt.lines).toEqual([{ speaker: "Dana Lee", text: "We are pausing new hires." }, { speaker: "Priya Shah", text: "Understood." }]);
    expect(parseTranscript("kickoff.txt", CALL_TXT).lines[1]).toEqual({ speaker: "Dana Lee", text: "Really happy with the speed so far, the team is impressed." });
    const otter = parseTranscript("otter.txt", "Dana Lee  0:05\nWe love the new lists.\nThey convert.\n\nPriya Shah  0:20\nGreat to hear.");
    expect(otter.lines).toEqual([{ speaker: "Dana Lee", text: "We love the new lists. They convert." }, { speaker: "Priya Shah", text: "Great to hear." }]);
    const fathom = parseTranscript("fathom.md", "# Weekly sync\n0:05 - Dana Lee\nBudget is tight this quarter.\n");
    expect(fathom.lines).toEqual([{ speaker: "Dana Lee", text: "Budget is tight this quarter." }]);
    expect(fathom.date).toBeNull();
  });
});

describe("campaign CSV", () => {
  it("maps common column names and sums into Monday weeks", () => {
    const r = parseCampaignCsv(CAMPAIGN_CSV);
    expect(r.mapped).toEqual({ date: "Date", sent: "Emails Sent", replies: "Replies", positive: "Positive Replies", meetings: "Meetings Booked" });
    expect(r.weeks).toHaveLength(9);
    expect(r.weeks[1]).toEqual({ week_start: "2026-08-24", sent: 1000, replies: 32, positive: 9, meetings: 3 });
  });

  it("groups daily rows and reads day-first dates", () => {
    const r = parseCampaignCsv("day;sent;interested;booked\n30/09/2026;100;2;1\n01/10/2026;120;1;0\n05/10/2026;90;3;2\nbad;1;1;1");
    expect(r.weeks).toEqual([
      { week_start: "2026-09-28", sent: 220, replies: 0, positive: 3, meetings: 1 },
      { week_start: "2026-10-05", sent: 90, replies: 0, positive: 3, meetings: 2 },
    ]);
    expect(r.skipped).toBe(1);
  });

  it("explains what is missing", () => {
    expect(() => parseCampaignCsv("campaign,sent\nA,100")).toThrow(/date column/);
    expect(() => parseCampaignCsv("date,sent\n2026-10-01,100")).toThrow(/results column/);
  });
});

describe("redaction", () => {
  it("removes emails, phone numbers and key-like strings but keeps dates and numbers", () => {
    expect(redact("Mail dana@acme.example or call +1 415 555 0134 / (020) 7946-0958.")).toBe("Mail [email] or call [phone] / [phone].");
    expect(redact("On 2026-10-01 we booked 12 meetings, 3% reply rate, Q3.")).toBe("On 2026-10-01 we booked 12 meetings, 3% reply rate, Q3.");
    expect(redact("token sk-abcdefghijklmnop123")).toBe("token [key]");
  });
});
