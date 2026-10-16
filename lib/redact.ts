// Contact details never leave the computer: they are replaced before any text is sent to Muse
// Wonder. Quotes are checked against the redacted text, so evidence shows the redacted version.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 7+ digits with optional +, spaces, dots, dashes or brackets: phone numbers, not "Q3" or "2026".
const PHONE = /(?<![\w-])(?:\+|\()?\d[\d\s().-]{6,}\d(?![\w-])/g;
const SECRETISH = /\b(?:sk|pk|xox[abpr]|ghp|api|key)[-_][A-Za-z0-9_-]{12,}\b/gi;

export function redact(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(SECRETISH, "[key]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 7 && !/^\d{4}-\d{2}-\d{2}$/.test(m.trim()) ? "[phone]" : m));
}
