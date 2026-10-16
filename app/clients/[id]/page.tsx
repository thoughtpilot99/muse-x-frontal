import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { latestView, viewRun } from "@/lib/accounts";
import { config } from "@/lib/config";
import { callsOf, getClient, messagesOf, runsOf, weeksOf } from "@/lib/db";
import { CATEGORY_LABEL } from "@/lib/risk";
import { ActionForm } from "@/components/ActionForm";
import { ClientFields } from "@/components/ClientFields";
import { Card, LevelPill, Stat, StatusPill, inputClass } from "@/components/ui";
import {
  analyzeAction, clearDataAction, deleteClientAction, editClientAction, importCallsAction, importCampaignsAction, importSlackAction, importSlackApiAction,
} from "../../actions";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  await connection();
  const { id } = await params;
  const c = getClient(Number(id));
  if (!c) notFound();
  const v = latestView(c.id);
  const msgs = messagesOf(c.id);
  const calls = callsOf(c.id);
  const weeks = weeksOf(c.id);
  const history = runsOf(c.id, 8).map((r) => viewRun(r));
  const hidden = <input type="hidden" name="id" value={c.id} />;
  const side = (s: string) => msgs.filter((m) => m.side === s).length;
  const concerns = v?.evidence.items.filter((i) => i.category !== "positive_signal") ?? [];
  const positives = v?.evidence.items.filter((i) => i.category === "positive_signal") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-muted underline">Clients</Link>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          {v && <div className="mt-1"><StatusPill risk={v.risk} /> <span className="text-xs text-muted">analysed {v.created_at} UTC</span></div>}
        </div>
        <ActionForm action={analyzeAction} submit={[{ label: v ? "Analyse again" : "Analyse" }]}>{hidden}</ActionForm>
      </div>

      {v?.error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{v.error}</p>}

      {v && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Health" value={v.risk.health ?? "–"} hint={`${Math.round(v.risk.coverage * 100)}% of the areas have data`} />
            <Stat label={v.facts.results.metric} value={v.facts.results.known ? `${v.facts.results.last28}` : "–"} hint={v.facts.results.known ? `last 28 days, ${v.facts.results.prev28} before${v.facts.results.target28 !== null ? `, target ${v.facts.results.target28}` : ""}` : "no recent campaign data"} />
            <Stat label="Client messages" value={v.facts.engagement.known ? v.facts.engagement.clientMsgsLast28 : "–"} hint={v.facts.engagement.daysSinceClientMsg !== null ? `last one ${v.facts.engagement.daysSinceClientMsg} days ago` : "no Slack data"} />
            <Stat label="Renewal" value={v.facts.contract.daysToRenewal !== null ? `${v.facts.contract.daysToRenewal}d` : "–"} hint={v.facts.contract.renewalDate ?? "not set"} />
          </div>

          {v.explanation && (
            <Card title="What's going on">
              <p>{v.explanation.why}</p>
              {v.changes.length > 0 && <p className="mt-2 text-sm text-muted">Since last time: {v.changes.join(" ")}</p>}
            </Card>
          )}
          {!config.museApiKey() && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">Connect Muse Wonder on <Link href="/setup" className="underline">Setup</Link> to read the conversations and get a save plan. The numbers below don&apos;t need it.</p>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            {v.risk.areas.map((a) => (
              <div key={a.key} className="rounded-lg border border-line bg-panel p-3">
                <div className="flex items-center justify-between"><span className="font-medium">{a.label}</span><LevelPill level={a.level} /></div>
                <p className="mt-1 text-sm text-muted">{a.reason}</p>
              </div>
            ))}
          </div>

          {v.explanation && (
            <div className="grid gap-3 md:grid-cols-2">
              <Card title="Save plan">
                <ol className="list-decimal space-y-2 pl-5 text-sm">
                  {v.explanation.plan.map((p) => <li key={p.action}>{p.action} <span className="text-muted">({p.owner}, within {p.within_days} days)</span></li>)}
                </ol>
              </Card>
              <Card title="Ask on the next call">
                <ul className="list-disc space-y-1 pl-5 text-sm">{v.explanation.ask_on_next_call.map((q) => <li key={q}>{q}</li>)}</ul>
              </Card>
            </div>
          )}

          {(concerns.length > 0 || positives.length > 0) && (
            <Card title="What the client said (quotes checked word for word)">
              <ul className="space-y-3 text-sm">
                {[...concerns, ...positives].map((i) => (
                  <li key={`${i.snippetId}-${i.quote}`} className={`border-l-4 pl-3 ${i.category === "positive_signal" ? "border-emerald-500" : "border-red-500"}`}>
                    <div className="text-xs text-muted">{CATEGORY_LABEL[i.category]} · {i.source === "slack" ? "Slack" : "Call"} · {i.date}{i.author ? ` · ${i.author}` : ""}</div>
                    <div>&ldquo;{i.quote}&rdquo;</div>
                    {i.why && <div className="text-xs text-muted">{i.why}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {[...v.evidence.unverified, ...(v.explanation?.unverified ?? [])].length > 0 && (
            <p className="rounded-md border-l-4 border-amber-500 bg-panel px-3 py-2 text-sm">
              <b>Left out because they could not be checked against the source:</b> {[...v.evidence.unverified, ...(v.explanation?.unverified ?? [])].join(" · ")}
            </p>
          )}
        </>
      )}

      <h2 className="pt-2 text-lg font-semibold">Data</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title={`Slack · ${msgs.length} messages`}>
          <p className="mb-2 text-xs text-muted">{side("client")} from the client, {side("team")} from your team, {side("unknown")} unknown.</p>
          <ActionForm action={importSlackAction} submit={[{ label: "Import export", tone: "neutral" }]}>
            {hidden}
            <input name="files" type="file" multiple accept=".zip,.json" className={inputClass} />
            <input name="channel" placeholder="Channel name (if the export has several)" className={`${inputClass} mt-2`} />
            <p className="mt-1 text-xs text-muted">The workspace export ZIP (Slack → Settings → Import/export), or the channel&apos;s day files plus users.json.</p>
          </ActionForm>
          {c.slack_channel && (
            <ActionForm action={importSlackApiAction} submit={[{ label: "Read from Slack (read-only)", tone: "neutral" }]}>
              {hidden}
              {!config.slackToken() && <p className="text-xs text-muted">Needs a bot token on <Link href="/setup" className="underline">Setup</Link>.</p>}
            </ActionForm>
          )}
        </Card>
        <Card title={`Calls · ${calls.length}`}>
          {calls.length > 0 && <p className="mb-2 text-xs text-muted">Latest: {calls.at(-1)!.date} · {calls.at(-1)!.title}</p>}
          <ActionForm action={importCallsAction} submit={[{ label: "Import transcripts", tone: "neutral" }]}>
            {hidden}
            <input name="files" type="file" multiple accept=".txt,.vtt,.srt,.md" className={inputClass} />
            <textarea name="pasted" rows={3} placeholder="…or paste a transcript" className={`${inputClass} mt-2`} />
            <input name="date" type="date" className={`${inputClass} mt-2`} />
            <p className="mt-1 text-xs text-muted">Fireflies, Fathom, Gong, Zoom, Otter (.txt .vtt .srt .md). Date from the file name, or the field above.</p>
          </ActionForm>
        </Card>
        <Card title={`Results · ${weeks.length} weeks`}>
          {weeks.length > 0 && <p className="mb-2 text-xs text-muted">{weeks[0].week_start} to {weeks.at(-1)!.week_start}</p>}
          <ActionForm action={importCampaignsAction} submit={[{ label: "Import CSV", tone: "neutral" }]}>
            {hidden}
            <input name="file" type="file" accept=".csv,text/csv" className={inputClass} />
            <p className="mt-1 text-xs text-muted">Export from Instantly, Smartlead, HeyReach or a sheet. Needs a date column plus meetings, positive replies or replies.</p>
          </ActionForm>
        </Card>
      </div>
      <ActionForm action={clearDataAction} submit={[{ label: "Remove Slack data", intent: "slack", tone: "danger" }, { label: "Remove calls", intent: "calls", tone: "danger" }, { label: "Remove results", intent: "campaigns", tone: "danger" }]}>
        {hidden}
      </ActionForm>

      {history.length > 1 && (
        <Card title="History">
          <table className="w-full text-sm">
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-line first:border-0">
                  <td className="py-1 pr-3 text-muted">{h.created_at.slice(0, 10)}</td>
                  <td className="py-1"><StatusPill risk={h.risk} /></td>
                  <td className="py-1 text-muted">{h.risk.areas.map((a) => `${a.label} ${a.level}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <details className="rounded-lg border border-line bg-panel p-4">
        <summary className="cursor-pointer text-sm font-medium">Edit client details</summary>
        <ActionForm action={editClientAction} submit={[{ label: "Save", tone: "neutral" }]} className="mt-4">
          {hidden}
          <ClientFields c={c} />
        </ActionForm>
        <ActionForm action={deleteClientAction} submit={[{ label: "Delete client and all its data", tone: "danger" }]} className="mt-6">
          {hidden}
          <input name="confirm" placeholder={`Type "${c.name}" to confirm`} className={inputClass} />
        </ActionForm>
      </details>
    </div>
  );
}
