import { ActionForm } from "@/components/ActionForm";
import { ClientFields } from "@/components/ClientFields";
import { Card } from "@/components/ui";
import { createClientAction } from "../../actions";

export default function NewClientPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a client</h1>
        <p className="text-sm text-muted">
          One account you serve. After this you&apos;ll import its Slack channel, call transcripts and campaign results. Everything stays on this computer.
        </p>
      </div>
      <ActionForm action={createClientAction} submit={[{ label: "Add client" }]}>
        <Card><ClientFields /></Card>
      </ActionForm>
    </div>
  );
}
