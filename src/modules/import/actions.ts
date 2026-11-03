"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { anthropicModel, extractSchedule, hasModelKey, type ModelDocument } from "./model";
import type { ParsedRow, RowError } from "./parse";
import { confirmImport, previewImport } from "./service";
import type { ImportPlan } from "./plan";

/** The screen's whole state: what was submitted, and what it would do. */
export type ImportState = FormState & {
  /** The source text, carried so Confirm re-parses exactly what was previewed. */
  text?: string;
  /** Rows the model produced, when the source was a document rather than a CSV. */
  rows?: ParsedRow[];
  modelErrors?: RowError[];
  plan?: ImportPlan;
  done?: boolean;
};

const MAX_TEXT = 500_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function readUpload(file: File): Promise<{ document: ModelDocument } | { error: string } | { csv: string }> {
  if (file.size > MAX_FILE_BYTES) {
    return { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB.` };
  }

  const type = file.type || "";
  const name = file.name.toLowerCase();

  if (type === "text/csv" || type === "text/tab-separated-values" || name.endsWith(".csv") || name.endsWith(".tsv")) {
    return { csv: await file.text() };
  }
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    return { document: { kind: "pdf", base64: Buffer.from(await file.arrayBuffer()).toString("base64") } };
  }
  if (IMAGE_TYPES.has(type)) {
    return { document: { kind: "image", mediaType: type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") } };
  }
  return { error: "That file is not a CSV, a PDF or an image." };
}

/**
 * Build the preview. Nothing is written here — this is the whole point of the screen: Devon
 * sees exactly what an import would change before it changes anything.
 */
export async function previewAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  await requireOwner();
  const { timezone } = await getSettings();
  const db = getDb();

  const pasted = z.string().max(MAX_TEXT).safeParse(form.get("text") ?? "");
  if (!pasted.success) return { error: "That is too much text to read at once." };

  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? upload : null;

  // A document goes to the model; a CSV, pasted or uploaded, goes to the parser.
  if (file) {
    const read = await readUpload(file);
    if ("error" in read) return { error: read.error };

    if ("csv" in read) {
      return { text: read.csv, plan: await previewImport(db, { text: read.csv, timeZone: timezone }) };
    }

    if (!hasModelKey()) {
      return { error: "Reading a PDF or an image needs a model key. Paste the schedule as text or CSV instead." };
    }
    try {
      const { rows, errors } = await extractSchedule(anthropicModel(), read.document);
      return { rows, modelErrors: errors, plan: await previewImport(db, { rows, errors, timeZone: timezone }) };
    } catch (error) {
      console.error(JSON.stringify({ event: "import_model_failed", detail: String(error) }));
      return { error: "Reading that document failed. Try again, or paste the schedule as text." };
    }
  }

  const text = pasted.data.trim();
  if (!text) return { error: "Paste a schedule or choose a file." };

  // Pasted text that is not a CSV goes to the model, when there is one.
  const looksTabular = /(^|\n)[^\n]*[,\t][^\n]*(\n|$)/.test(text);
  if (!looksTabular) {
    if (!hasModelKey()) {
      return { error: "That does not look like CSV, and reading free text needs a model key." };
    }
    try {
      const { rows, errors } = await extractSchedule(anthropicModel(), { kind: "text", text });
      return { rows, modelErrors: errors, plan: await previewImport(db, { rows, errors, timeZone: timezone }) };
    } catch (error) {
      console.error(JSON.stringify({ event: "import_model_failed", detail: String(error) }));
      return { error: "Reading that text failed. Try again, or paste it as CSV." };
    }
  }

  return { text, plan: await previewImport(db, { text, timeZone: timezone }) };
}

/** Apply what the preview showed. The source is re-parsed, so the plan cannot have gone stale. */
export async function confirmAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  await requireOwner();
  const { timezone } = await getSettings();

  const text = String(form.get("text") ?? "");
  const rowsJson = String(form.get("rows") ?? "");
  const rows = rowsJson ? (JSON.parse(rowsJson) as ParsedRow[]) : undefined;

  if (!text && !rows?.length) return { error: "There is nothing to import. Build a preview first." };

  const result = await confirmImport(getDb(), { text: text || undefined, rows, timeZone: timezone });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/", "layout");
  const { created, updated, removed, unchanged } = result.data;
  return {
    done: true,
    ok: `Imported. ${created} added, ${updated} updated, ${removed} removed, ${unchanged} already up to date.`,
  };
}
