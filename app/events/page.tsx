import { connection } from "next/server";
import { all } from "@/lib/db";

type Row = { id: number; source: string; kind: string; ok: number; note: string | null; payload: string | null; created_at: string };

export default async function EventsPage() {
  await connection();
  const events = all<Row>("SELECT id, source, kind, ok, note, payload, created_at FROM events ORDER BY id DESC LIMIT 200");
  const ai = all<{ step: string; calls: number; cost: number | null; failed: number }>("SELECT step, COUNT(*) AS calls, SUM(cost_usd) AS cost, SUM(1 - ok) AS failed FROM ai_runs GROUP BY step ORDER BY step");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Events</h1>
        <p className="text-sm text-muted">Muse Wonder calls with their cost, Slack imports, and errors.</p>
      </div>
      {ai.length > 0 && (
        <table className="w-full max-w-xl text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-1">Muse Wonder step</th><th>Calls</th><th>Failed</th><th>Cost</th></tr></thead>
          <tbody>{ai.map((l) => <tr key={l.step}><td className="py-1 font-mono text-xs">{l.step}</td><td>{l.calls}</td><td>{l.failed}</td><td className="tabular-nums">${(l.cost ?? 0).toFixed(3)}</td></tr>)}</tbody>
        </table>
      )}
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${e.ok ? "bg-emerald-500" : "bg-red-500"}`} />
              <strong>{e.source}</strong>
              <span className="font-mono text-xs">{e.kind}</span>
              <span className="text-xs text-muted">{e.created_at} UTC</span>
            </div>
            {e.note && <p className="mt-1 text-muted">{e.note}</p>}
            {e.payload && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted">Raw response</summary>
                <pre className="mt-2 max-h-80 overflow-auto text-xs">{e.payload}</pre>
              </details>
            )}
          </li>
        ))}
        {!events.length && <li className="text-sm text-muted">No events yet.</li>}
      </ul>
    </div>
  );
}
