import { all, run } from "./db";

export type Settings = {
  /** Your agency in one or two sentences, so the save plans fit how you work. */
  agency: string;
  /** How far back conversations are read, in days. */
  lookbackDays: number;
  /** Days without a client message before engagement turns amber, then red. */
  quietDaysAmber: number;
  quietDaysRed: number;
  /** A renewal this close (days) makes an at-risk client urgent. */
  renewalUrgentDays: number;
};

export const DEFAULT_SETTINGS: Settings = {
  agency: "",
  lookbackDays: 90,
  quietDaysAmber: 10,
  quietDaysRed: 21,
  renewalUrgentDays: 45,
};

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in s)) continue;
    const k = key as keyof Settings;
    (s as Record<string, unknown>)[k] = typeof DEFAULT_SETTINGS[k] === "number" ? Number(value) : value;
  }
  return s;
}

export function saveSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, String(value),
    );
  }
}
