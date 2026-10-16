import { deflateRawSync } from "node:zlib";

// A FICTIONAL account for tests and the demo: "Acme Robotics" (acme.example), served by an
// agency at agency.example. Names, messages and numbers are made up; the shapes match real
// Slack exports, transcript files and sequencer CSVs.

export const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const at = (iso: string) => String(Date.parse(iso) / 1000);

export const USERS = [
  { id: "UDANA", name: "dana", real_name: "Dana Lee", profile: { real_name: "Dana Lee", email: "dana@acme.example" } },
  { id: "USAM", name: "sam", real_name: "Sam Ortiz", profile: { real_name: "Sam Ortiz", email: "sam@acme.example" } },
  { id: "UPRIYA", name: "priya", real_name: "Priya Shah", profile: { real_name: "Priya Shah", email: "priya@agency.example" } },
];

type SlackMsg = { type: string; user?: string; text: string; ts: string; subtype?: string; bot_id?: string };

/** Day files for #acme-shared: { "acme-shared/2026-09-20.json": [...] } */
export function slackDays(): Record<string, SlackMsg[]> {
  const days: Record<string, SlackMsg[]> = {};
  const push = (iso: string, m: Omit<SlackMsg, "ts" | "type">) => {
    const key = `acme-shared/${iso.slice(0, 10)}.json`;
    (days[key] ??= []).push({ type: "message", ts: at(iso), ...m });
  };
  // Dana, the main contact, every 4 days from 20 Jul to 10 Sep (14 messages), then two more.
  for (let t = Date.parse("2026-07-20T15:00:00Z"); t <= Date.parse("2026-09-10T15:00:00Z"); t += 4 * DAY) {
    push(new Date(t).toISOString(), { user: "UDANA", text: "Thanks <@UPRIYA>, looks good. Let's keep the same sequence for the next batch." });
  }
  push("2026-09-20T16:00:00Z", {
    user: "UDANA",
    text: "Honestly the meetings this month have been underwhelming. Leadership is asking if we should bring outbound in-house next quarter. Call me on +1 415 555 0134 if easier.",
  });
  push("2026-10-03T09:30:00Z", { user: "USAM", text: "Hi all, I'm taking over growth from Dana starting next month. Can someone send me a summary of what's running?" });
  // Priya (agency side) posts updates every 3 days from 18 Jul to 14 Oct.
  for (let t = Date.parse("2026-07-18T10:00:00Z"); t <= Date.parse("2026-10-14T10:00:00Z"); t += 3 * DAY) {
    push(new Date(t).toISOString(), { user: "UPRIYA", text: "Weekly update: new batch is live, details in the doc <https://docs.example/acme|here>." });
  }
  push("2026-08-01T10:00:00Z", { subtype: "channel_join", user: "USAM", text: "<@USAM> has joined the channel" });
  push("2026-08-02T10:00:00Z", { bot_id: "B1", text: "Instantly: campaign paused" });
  return days;
}

export const CALL_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Priya Shah>Thanks for joining, Dana.</v>

00:00:05.000 --> 00:00:11.000
<v Dana Lee>The reply rates are fine but we need booked meetings, the board only cares about pipeline.</v>

00:00:12.000 --> 00:00:15.000
<v Dana Lee>If October doesn't pick up we will have to rethink the budget.</v>
`;

export const CALL_TXT = `Priya Shah: How did the first month feel?
Dana Lee: Really happy with the speed so far, the team is impressed.
`;

/** Weekly results: 4 + 10 meetings before the last 28 days, then 3. */
export const CAMPAIGN_CSV = [
  "Date,Emails Sent,Replies,Positive Replies,Meetings Booked",
  "2026-08-17,900,30,8,4",
  "2026-08-24,1000,32,9,3",
  "2026-08-31,1000,31,8,3",
  "2026-09-07,1000,28,6,2",
  "2026-09-14,1000,25,6,2",
  "2026-09-21,1000,20,3,1",
  "2026-09-28,1000,18,3,1",
  "2026-10-05,1000,17,2,1",
  "2026-10-12,800,10,1,0",
].join("\n");

export const CLIENT_INPUT = {
  name: "Acme Robotics",
  teamDomains: "agency.example",
  clientDomains: "acme.example",
  teamNames: "Priya Shah",
  monthlyFee: "8000",
  startDate: "2026-04-01",
  renewalDate: "2026-11-15",
  targetMeetings: "12",
  slackChannel: "C0ACME",
  notes: "",
};

/** A minimal ZIP writer (deflate), so tests exercise the real export path. */
export function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function exportZip(extraChannel = false): Buffer {
  const files: Record<string, string> = { "users.json": JSON.stringify(USERS), "channels.json": "[]" };
  for (const [k, v] of Object.entries(slackDays())) files[k] = JSON.stringify(v);
  if (extraChannel) files["general/2026-09-01.json"] = JSON.stringify([{ type: "message", user: "UPRIYA", text: "hi", ts: at("2026-09-01T10:00:00Z") }]);
  return zip(files);
}
