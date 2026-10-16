import type { Client } from "@/lib/db";
import { inputClass } from "./ui";

const join = (json: string | undefined) => (json ? (JSON.parse(json) as string[]).join(", ") : "");

function Field({ name, label, hint, value, type = "text", placeholder }: { name: string; label: string; hint?: string; value?: string | number | null; type?: string; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={`${inputClass} mt-1`} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Shared by "Add client" and the edit form on a client's page. */
export function ClientFields({ c }: { c?: Client }) {
  return (
    <div className="space-y-4">
      <Field name="name" label="Client name" value={c?.name} placeholder="e.g. Acme Robotics" />
      <div className="grid gap-3 md:grid-cols-3">
        <Field name="teamDomains" label="Your agency's email domain(s)" value={join(c?.team_domains)} placeholder="youragency.com" hint="Tells your messages apart from the client's" />
        <Field name="clientDomains" label="Client's email domain(s)" value={join(c?.client_domains)} placeholder="acme.com" />
        <Field name="teamNames" label="Your teammates' names (optional)" value={join(c?.team_names)} placeholder="Priya Shah, Tom Ruiz" hint="For transcripts and exports without emails" />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field name="monthlyFee" label="Monthly fee" value={c?.monthly_fee} placeholder="8000" />
        <Field name="targetMeetings" label="Target meetings per month" value={c?.target_meetings} placeholder="12" hint="From the contract, if any" />
        <Field name="startDate" label="Client since" type="date" value={c?.start_date} />
        <Field name="renewalDate" label="Next renewal" type="date" value={c?.renewal_date} />
      </div>
      <Field name="slackChannel" label="Slack channel ID (optional, for the read-only Slack import)" value={c?.slack_channel} placeholder="C0123ABCD" />
      <label className="block text-sm">
        <span className="text-xs text-muted">Notes</span>
        <textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} className={`${inputClass} mt-1`} />
      </label>
    </div>
  );
}
