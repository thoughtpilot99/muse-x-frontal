// Call transcripts from Fireflies, Fathom, Gong, Zoom, Otter or Google Meet exports. Each
// format becomes the same thing: a date, a title and "Speaker: what they said" lines.

export type Line = { speaker: string | null; text: string };
export type Transcript = { date: string | null; title: string; lines: Line[] };

const TIME = /\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?/;
const CUE = new RegExp(`^${TIME.source}\\s*-->\\s*${TIME.source}`);
const NAME = "[A-Za-zÀ-ÿ][\\w .'\\-À-ÿ]{0,40}?";
// "Dana Lee: text", "Dana Lee (00:12): text", "[00:12] Dana Lee: text"
const SPEAKER_LINE = new RegExp(`^(?:\\[?${TIME.source}\\]?\\s*)?(${NAME})\\s*(?:\\(${TIME.source}\\))?\\s*:\\s+(.+)$`);
// Otter/Zoom style: "Dana Lee  0:12" on its own line, text below
const SPEAKER_HEADER = new RegExp(`^(${NAME})\\s+${TIME.source}$`);
// Fathom style: "0:12 - Dana Lee"
const TIME_DASH_SPEAKER = new RegExp(`^${TIME.source}\\s+-\\s+(${NAME})$`);

function dateFrom(name: string, text: string): string | null {
  const m = name.match(/(\d{4})[-_.](\d{2})[-_.](\d{2})/) ?? text.slice(0, 500).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function cueLines(text: string): Line[] {
  const out: Line[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const rows = block.split("\n").map((r) => r.trim()).filter(Boolean);
    const at = rows.findIndex((r) => CUE.test(r));
    if (at < 0) continue;
    for (const row of rows.slice(at + 1)) {
      const voice = row.match(/^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/);
      if (voice) out.push({ speaker: voice[1].trim(), text: voice[2].replace(/<[^>]+>/g, "").trim() });
      else {
        const s = row.match(SPEAKER_LINE);
        out.push(s ? { speaker: s[1].trim(), text: s[2].trim() } : { speaker: null, text: row.replace(/<[^>]+>/g, "") });
      }
    }
  }
  // Consecutive cues from the same speaker read better as one line.
  const merged: Line[] = [];
  for (const l of out) {
    const prev = merged.at(-1);
    if (prev && (l.speaker === prev.speaker || l.speaker === null)) prev.text += ` ${l.text}`;
    else merged.push({ ...l });
  }
  return merged;
}

function plainLines(text: string): Line[] {
  const out: Line[] = [];
  let current: string | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const row = raw.trim().replace(/^[-*]\s+/, "");
    if (!row || /^#+\s/.test(row)) continue;
    const header = row.match(SPEAKER_HEADER) ?? row.match(TIME_DASH_SPEAKER);
    if (header) {
      current = header[1].trim();
      continue;
    }
    const s = row.match(SPEAKER_LINE);
    if (s && s[1].split(" ").length <= 4) {
      current = s[1].trim();
      out.push({ speaker: current, text: s[2].trim() });
    } else if (out.length && out.at(-1)!.speaker === current) out.at(-1)!.text += ` ${row}`;
    else out.push({ speaker: current, text: row });
  }
  return out;
}

export function parseTranscript(name: string, text: string): Transcript {
  const isCue = /\.(vtt|srt)$/i.test(name) || /^WEBVTT/.test(text.trimStart()) || CUE.test(text.split("\n").find((l) => l.includes("-->"))?.trim() ?? "");
  const lines = (isCue ? cueLines(text) : plainLines(text)).filter((l) => l.text.trim());
  const title = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Call";
  return { date: dateFrom(name, text), title, lines };
}

export const transcriptText = (lines: Line[]) => lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join("\n");

/** Back from stored text to lines (stored as "Speaker: text" per line). */
export function storedLines(text: string): Line[] {
  return text.split("\n").filter(Boolean).map((row) => {
    const m = row.match(/^([^:]{1,60}):\s(.*)$/);
    return m ? { speaker: m[1], text: m[2] } : { speaker: null, text: row };
  });
}
