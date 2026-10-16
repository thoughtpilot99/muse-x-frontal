import { inflateRawSync } from "node:zlib";

// Just enough of the ZIP format to read a Slack export (stored or deflated entries), so the app
// needs no extra dependency. Limits guard against zip bombs.

const MAX_ENTRIES = 20_000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

export type ZipEntry = { name: string; text: string };

export function readZip(buf: Buffer, accept: (name: string) => boolean = () => true): ZipEntry[] {
  // End of central directory: last occurrence of its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file is not a ZIP archive.");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error("The ZIP has too many files.");
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The ZIP file is damaged.");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || !accept(name)) continue;
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error("The ZIP is too large once unpacked (300 MB max).");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: size + 1024 }) : null;
    if (raw) out.push({ name, text: raw.toString("utf8") });
  }
  return out;
}
