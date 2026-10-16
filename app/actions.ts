"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MissingKeysError } from "@/lib/config";
import {
  analyzeClient, createClient, editClient, importCampaigns, importSlackApi, importSlackFiles, importTranscripts, type ClientInput,
} from "@/lib/accounts";
import { clients, getClient, run } from "@/lib/db";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";

export type ActionResult = { ok: boolean; message: string };

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    revalidatePath("/", "layout");
    if (e instanceof MissingKeysError) {
      return { ok: false, message: `Connect these on the Setup page first: ${e.missing.map((m) => m.label).join(", ")}` };
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const idOf = (fd: FormData) => z.coerce.number().int().positive().parse(fd.get("id"));
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const files = (fd: FormData, k: string) => fd.getAll(k).filter((f): f is File => f instanceof File && f.size > 0);

const inputOf = (fd: FormData): ClientInput => ({
  name: str(fd, "name"), teamDomains: str(fd, "teamDomains"), clientDomains: str(fd, "clientDomains"), teamNames: str(fd, "teamNames"),
  monthlyFee: str(fd, "monthlyFee"), startDate: str(fd, "startDate"), renewalDate: str(fd, "renewalDate"),
  targetMeetings: str(fd, "targetMeetings"), slackChannel: str(fd, "slackChannel"), notes: str(fd, "notes"),
});

export async function createClientAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = 0;
  const result = await attempt(() => {
    id = createClient(inputOf(fd));
    return "Created.";
  });
  if (result.ok) redirect(`/clients/${id}`);
  return result;
}

export async function editClientAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    editClient(idOf(fd), inputOf(fd));
    return "Saved. Messages were re-sorted into client and team.";
  });
}

export async function importSlackAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const list = files(fd, "files");
    if (!list.length) throw new Error("Choose the Slack export ZIP, or the channel's day files.");
    const data = await Promise.all(list.map(async (f) => ({ name: f.webkitRelativePath || f.name, data: Buffer.from(await f.arrayBuffer()) })));
    return importSlackFiles(idOf(fd), data, str(fd, "channel").trim().replace(/^#/, "") || undefined);
  });
}

export async function importSlackApiAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => importSlackApi(idOf(fd)));
}

export async function importCallsAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const list = files(fd, "files");
    const pasted = str(fd, "pasted").trim();
    const all = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
    if (pasted) all.push({ name: `${str(fd, "date") || "call"}-pasted.txt`, text: pasted });
    if (!all.length) throw new Error("Choose transcript files or paste one.");
    return importTranscripts(idOf(fd), all, str(fd, "date"));
  });
}

export async function importCampaignsAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const [file] = files(fd, "file");
    const csv = file ? await file.text() : str(fd, "csv");
    if (!csv.trim()) throw new Error("Upload a CSV or paste one.");
    return importCampaigns(idOf(fd), csv);
  });
}

export async function analyzeAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const v = await analyzeClient(idOf(fd));
    const status = v.risk.health === null ? "Not enough data yet" : `${v.risk.status} (${v.risk.health}/100)`;
    return `${status}. ${v.evidence.items.length} piece(s) of evidence found.${v.error ? ` ${v.error}` : ""}`;
  });
}

export async function analyzeAllAction(): Promise<ActionResult> {
  return attempt(async () => {
    const list = clients();
    for (const c of list) await analyzeClient(c.id);
    return `Analysed ${list.length} client(s).`;
  });
}

export async function deleteClientAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = idOf(fd);
  if (str(fd, "confirm") !== getClient(id)?.name) return { ok: false, message: "Type the client's name to confirm." };
  run("DELETE FROM clients WHERE id = ?", id);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function clearDataAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const id = idOf(fd);
    const what = str(fd, "intent");
    const table = { slack: "messages", calls: "calls", campaigns: "campaign_weeks" }[what];
    if (!table) throw new Error("Unknown data type.");
    run(`DELETE FROM ${table} WHERE client_id = ?`, id);
    return "Removed.";
  });
}

export async function saveSettingsAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const patch: Partial<Settings> = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      const v = fd.get(key);
      if (v === null) continue;
      if (typeof def === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1) throw new Error(`${key} must be a positive number`);
        (patch as Record<string, unknown>)[key] = n;
      } else {
        (patch as Record<string, unknown>)[key] = String(v).trim().slice(0, 1000);
      }
    }
    saveSettings(patch);
    return "Settings saved.";
  });
}
