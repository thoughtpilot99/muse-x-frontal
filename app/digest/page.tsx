import { connection } from "next/server";
import { digestMarkdown, portfolio } from "@/lib/accounts";
import { clients } from "@/lib/db";
import { Card, inputClass } from "@/components/ui";

export default async function DigestPage() {
  await connection();
  const md = digestMarkdown(portfolio(clients()));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Weekly digest</h1>
        <p className="text-sm text-muted">
          Every client from the latest analysis, most at risk first, as markdown. Copy it into your team&apos;s Monday meeting notes or Slack yourself: Churn Radar never sends anything.
        </p>
      </div>
      <Card>
        <textarea readOnly rows={28} value={md} className={`${inputClass} font-mono text-xs`} />
      </Card>
    </div>
  );
}
