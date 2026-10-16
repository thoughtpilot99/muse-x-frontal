import { getSecret, type SecretName } from "./secrets";

// Each value comes from .env.local first, then from what was entered on /setup.
const val = (name: SecretName) => process.env[name] || getSecret(name) || "";

export const config = {
  museApiKey: () => val("MODEL_API_KEY"),
  museBaseUrl: () => process.env.MUSE_BASE_URL || "https://api.meta.ai/v1",
  museModel: () => process.env.MUSE_MODEL || "muse-wonder-1.0",
  slackToken: () => val("SLACK_BOT_TOKEN"),
};

// Muse Wonder list price, USD per million tokens (dev.meta.ai, Oct 2026).
export const MUSE_PRICE = { input: 4, cachedInput: 0.2, output: 20 };

export class MissingKeysError extends Error {
  constructor(public missing: { key: string; label: string }[]) {
    super(`Missing configuration: ${missing.map((m) => m.key).join(", ")}`);
  }
}

export function missingKeys() {
  return config.museApiKey() ? [] : [{ key: "MODEL_API_KEY", label: "Muse Wonder (Meta Model API)" }];
}

export function assertMuse() {
  const m = missingKeys();
  if (m.length) throw new MissingKeysError(m);
}
