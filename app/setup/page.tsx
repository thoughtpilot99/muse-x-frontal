import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { config } from "@/lib/config";
import { clients } from "@/lib/db";
import { getSecret, mask, secretSource, type SecretName } from "@/lib/secrets";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { saveKeyAction, testMuseAction, testSlackAction } from "./actions";

function KeyField({ name, label, help }: { name: SecretName; label: string; help: ReactNode }) {
  const source = secretSource(name);
  const current = process.env[name] || getSecret(name);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={source === "none" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {source === "none" ? "not connected" : `connected ${mask(current)}${source === "env" ? " (from .env.local)" : ""}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{help}</p>
      {source !== "env" && (
        <ActionForm action={saveKeyAction} submit={[{ label: source === "app" ? "Replace" : "Save", tone: "neutral" }]}>
          <input type="hidden" name="name" value={name} />
          <input name="value" type="password" autoComplete="off" placeholder={source === "app" ? "Paste a new key, or leave empty to remove" : "Paste key"} className={`${inputClass} mt-2`} />
        </ActionForm>
      )}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <Card title={`${n}. ${title}`} actions={<span className={done ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-sm text-muted"}>{done ? "✓ done" : "to do"}</span>}>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default async function SetupPage() {
  await connection();
  const s = getSettings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-sm text-muted">
          Keys are stored only on this computer (in <code>data/app.db</code>, never committed). Values in <code>.env.local</code> take precedence.
          Client conversations never leave this computer except the client-side excerpts sent to Muse Wonder, with emails and phone numbers removed.
        </p>
      </div>

      <Step n={1} title="Muse Wonder (reads the conversations)" done={!!config.museApiKey()}>
        <KeyField name="MODEL_API_KEY" label="Meta Model API key"
          help={<>Create one at <a className="underline" href="https://dev.meta.ai" target="_blank" rel="noreferrer">dev.meta.ai</a> → API keys. Model: <code>{config.museModel()}</code>. One client analysis costs a few cents.</>} />
        {config.museApiKey() && <ActionForm action={testMuseAction} submit={[{ label: "Test Muse Wonder", tone: "neutral" }]} />}
      </Step>

      <Step n={2} title="Slack (optional, read-only)" done={!!config.slackToken()}>
        <KeyField name="SLACK_BOT_TOKEN" label="Slack bot token (xoxb-...)"
          help={<>Only needed to read channels directly instead of uploading an export. Create an app at <a className="underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">api.slack.com/apps</a> with the read scopes <code>channels:history</code>, <code>groups:history</code>, <code>users:read</code> and <code>users:read.email</code>, install it, and invite it to the client channel. Churn Radar never asks for a write scope and never posts.</>} />
        {config.slackToken() && <ActionForm action={testSlackAction} submit={[{ label: "Test Slack", tone: "neutral" }]} />}
      </Step>

      <Step n={3} title="Describe your agency" done={!!s.agency}>
        <p className="text-sm">One or two sentences on the <Link className="underline" href="/settings">Settings</Link> page, so save plans fit how you work.</p>
      </Step>

      <Step n={4} title="Add your clients" done={clients().length > 0}>
        <p className="text-sm"><Link className="underline" href="/clients/new">Add a client</Link>, then import its Slack channel, call transcripts and a campaign results CSV.</p>
      </Step>
    </div>
  );
}
