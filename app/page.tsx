import Link from "next/link";
import { connection } from "next/server";
import { portfolio } from "@/lib/accounts";
import { config } from "@/lib/config";
import { clients, get } from "@/lib/db";
import { Checklist } from "@/components/Checklist";
import { ActionForm } from "@/components/ActionForm";
import { Card, Stat, StatusPill } from "@/components/ui";
import { analyzeAllAction } from "./actions";

export default async function Home() {
  await connection();
  const rows = portfolio(clients());
  const analysed = rows.filter((r) => r.view);
  const atRisk = analysed.filter((r) => r.view!.risk.status === "At risk");
  const urgent = analysed.filter((r) => r.view!.risk.urgent);
  const mrrAtRisk = atRisk.reduce((n, r) => n + (r.client.monthly_fee ?? 0), 0);
  const ai = get<{ cost: number | null }>("SELECT SUM(cost_usd) AS cost FROM ai_runs");
  const counts = get<{ m: number; c: number; w: number }>(
    "SELECT (SELECT COUNT(*) FROM messages) AS m, (SELECT COUNT(*) FROM calls) AS c, (SELECT COUNT(*) FROM campaign_weeks) AS w",
  );
  const checklist = [
    { label: "Connect Muse Wonder", done: !!config.museApiKey(), href: "/setup" },
    { label: "Add a client", done: rows.length > 0, href: "/clients/new" },
    { label: "Import Slack, calls or results", done: !!(counts && counts.m + counts.c + counts.w), href: rows[0] ? `/clients/${rows[0].client.id}` : "/clients/new" },
    { label: "Run the first analysis", done: analysed.length > 0, href: rows[0] ? `/clients/${rows[0].client.id}` : "/clients/new" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Which clients are about to churn?</h1>
          <p className="text-sm text-muted">Slack, calls and campaign results for every account, read every week. Most at risk first.</p>
        </div>
        <div className="flex gap-2">
          {rows.length > 0 && <ActionForm action={analyzeAllAction} submit={[{ label: "Analyse all", tone: "neutral" }]} />}
          <Link href="/clients/new" className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Add client</Link>
        </div>
      </div>

      <Checklist items={checklist} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clients" value={rows.length} hint={`${analysed.length} analysed`} />
        <Stat label="At risk" value={atRisk.length} hint={urgent.length ? `${urgent.length} with a renewal soon` : "none renewing soon"} />
        <Stat label="Monthly fees at risk" value={mrrAtRisk ? mrrAtRisk.toLocaleString("en-US") : "0"} hint="Sum of fees for at-risk clients" />
        <Stat label="Muse Wonder spend" value={`$${(ai?.cost ?? 0).toFixed(2)}`} hint="All analyses so far" />
      </div>

      <Card title="Portfolio">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line"><th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Main reason</th><th className="py-2 pr-3">Renewal</th><th className="py-2">Analysed</th></tr>
              </thead>
              <tbody>
                {rows.map(({ client, view }) => {
                  const worst = view?.risk.areas.find((a) => a.level === "red") ?? view?.risk.areas.find((a) => a.level === "amber");
                  return (
                    <tr key={client.id} className="border-b border-line align-top last:border-0">
                      <td className="py-2 pr-3"><Link href={`/clients/${client.id}`} className="font-medium hover:underline">{client.name}</Link></td>
                      <td className="py-2 pr-3">{view ? <StatusPill risk={view.risk} /> : <span className="text-muted">not analysed</span>}</td>
                      <td className="py-2 pr-3 text-muted">{worst ? `${worst.label}: ${worst.reason}` : view ? "Nothing worrying" : "–"}</td>
                      <td className="py-2 pr-3 tabular-nums">{view?.facts.contract.daysToRenewal != null ? `${view.facts.contract.daysToRenewal}d` : client.renewal_date ?? "–"}</td>
                      <td className="py-2 text-muted">{view ? view.created_at.slice(0, 10) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No clients yet. <Link href="/clients/new" className="underline">Add your first client</Link>.</p>
        )}
      </Card>
    </div>
  );
}
