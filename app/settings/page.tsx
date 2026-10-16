import Link from "next/link";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { saveSettingsAction } from "../actions";

export default async function SettingsPage() {
  await connection();
  const s = getSettings();
  const field = (name: keyof typeof s, label: string, hint?: string) => (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input name={name} type="number" min={1} step={1} defaultValue={String(s[name])} className={`${inputClass} mt-1`} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Keys are on the <Link href="/setup" className="underline">Setup</Link> page.</p>
      </div>
      <ActionForm action={saveSettingsAction} submit={[{ label: "Save settings" }]} className="space-y-4">
        <Card title="Your agency">
          <textarea name="agency" rows={3} defaultValue={s.agency} className={inputClass}
            placeholder="e.g. Outbound agency for B2B SaaS. Each client has one GTM engineer and a weekly call; we run email and LinkedIn." />
        </Card>
        <Card title="Rules">
          <div className="grid gap-3 md:grid-cols-2">
            {field("lookbackDays", "Read conversations from the last (days)", "How far back Muse Wonder reads Slack and calls")}
            {field("renewalUrgentDays", "Renewal counts as soon within (days)", "An account that isn't healthy and renews this soon is marked urgent")}
            {field("quietDaysAmber", "Client silent for more than (days): watch")}
            {field("quietDaysRed", "Client silent for more than (days): risk")}
          </div>
        </Card>
      </ActionForm>
    </div>
  );
}
