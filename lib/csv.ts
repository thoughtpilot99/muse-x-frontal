/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). Keeps the original headers. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Spreadsheet exports use commas, semicolons (EU locales) or tabs; pick the one in the header row.
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  return { headers: nonEmpty[0].map((h) => h.trim()), rows: nonEmpty.slice(1).map((r) => r.map((c) => c.trim())) };
}
