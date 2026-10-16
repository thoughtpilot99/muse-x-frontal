import type { ReactNode } from "react";
import type { Level, RiskResult } from "@/lib/risk";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const LEVEL_STYLE: Record<Level, string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  unknown: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};
const LEVEL_TEXT: Record<Level, string> = { green: "OK", amber: "Watch", red: "Risk", unknown: "Unknown" };

export function LevelPill({ level }: { level: Level }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}>{LEVEL_TEXT[level]}</span>;
}

const STATUS_STYLE: Record<RiskResult["status"], string> = {
  Healthy: LEVEL_STYLE.green,
  Watch: LEVEL_STYLE.amber,
  "At risk": LEVEL_STYLE.red,
  "Not enough data": LEVEL_STYLE.unknown,
};

export function StatusPill({ risk }: { risk: Pick<RiskResult, "status" | "health" | "urgent"> }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[risk.status]}`}>
        {risk.status}{risk.health !== null ? ` · ${risk.health}` : ""}
      </span>
      {risk.urgent && <span className="inline-block rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Renewal soon</span>}
    </span>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";
