import { parseCsv } from "../csv";

// Campaign results from any sequencer's CSV export (Instantly, Smartlead, HeyReach, lemlist,
// or a sheet you keep by hand). Rows can be daily, weekly or per campaign per day; they are
// summed into Monday-starting weeks.

export type Week = { week_start: string; sent: number; replies: number; positive: number; meetings: number };

const COLUMNS: Record<keyof Omit<Week, "week_start"> | "date", RegExp> = {
  date: /^(date|day|week|week start|week_start|period|sent date|timestamp)$/i,
  sent: /^(sent|emails? sent|contacted|messages? sent|connection requests? sent|sends|total sent)$/i,
  replies: /^(replies|replied|reply|total replies|replies received|reply count)$/i,
  positive: /^(positive|positive replies|interested|leads? interested|opportunities|positive responses?)$/i,
  meetings: /^(meetings?|meetings? booked|booked|booked meetings|calls? booked|demos?|appointments?)$/i,
};

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[,\s%]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function mondayOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

const SLASHED = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/;

/** 30/09/2026 vs 09/30/2026: decided once per file, from any part over 12. US order when unclear. */
function dayFirst(values: string[]): boolean {
  for (const v of values) {
    const m = v.trim().match(SLASHED);
    if (m && +m[1] > 12) return true;
    if (m && +m[2] > 12) return false;
  }
  return false;
}

function parseDate(v: string, dmy: boolean): Date | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(SLASHED);
  if (m) {
    const [day, month] = dmy ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? new Date(Date.UTC(+m[3], month - 1, day)) : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function parseCampaignCsv(text: string): { weeks: Week[]; skipped: number; mapped: Record<string, string> } {
  const { headers, rows } = parseCsv(text);
  const idx: Partial<Record<keyof typeof COLUMNS, number>> = {};
  const mapped: Record<string, string> = {};
  for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    const i = headers.findIndex((h) => COLUMNS[key].test(h.trim()));
    if (i >= 0) {
      idx[key] = i;
      mapped[key] = headers[i];
    }
  }
  if (idx.date === undefined) throw new Error("The CSV needs a date column (date, day or week).");
  if (idx.meetings === undefined && idx.positive === undefined && idx.replies === undefined) {
    throw new Error("The CSV needs at least one results column: meetings booked, positive replies or replies.");
  }
  const byWeek = new Map<string, Week>();
  const dmy = dayFirst(rows.map((r) => r[idx.date!] ?? ""));
  let skipped = 0;
  for (const r of rows) {
    const d = parseDate(r[idx.date] ?? "", dmy);
    if (!d) {
      skipped++;
      continue;
    }
    const wk = mondayOf(d);
    const w = byWeek.get(wk) ?? { week_start: wk, sent: 0, replies: 0, positive: 0, meetings: 0 };
    w.sent += idx.sent === undefined ? 0 : num(r[idx.sent]);
    w.replies += idx.replies === undefined ? 0 : num(r[idx.replies]);
    w.positive += idx.positive === undefined ? 0 : num(r[idx.positive]);
    w.meetings += idx.meetings === undefined ? 0 : num(r[idx.meetings]);
    byWeek.set(wk, w);
  }
  return { weeks: [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)), skipped, mapped };
}
