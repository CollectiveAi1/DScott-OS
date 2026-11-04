import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { DealForm, PipelineBoard } from "@/modules/crm/components/board";
import { centsToInput } from "@/modules/crm/money";
import { contactOptions, dealById, loadBoards } from "@/modules/crm/queries";

export const metadata: Metadata = { title: "Pipelines" };

export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const db = getDb();
  const { timezone } = await getSettings();
  const today = dateInZone(new Date(), timezone);
  const params = await searchParams;

  const [boards, contacts] = await Promise.all([loadBoards(db), contactOptions(db)]);
  const pipelineOptions = boards.map((board) => ({
    id: board.pipeline.id,
    name: board.pipeline.name,
    stages: board.pipeline.stages,
  }));

  const dealId = typeof params.deal === "string" ? params.deal : null;
  const editing = dealId ? await dealById(db, dealId) : null;
  const adding = params.new === "1";

  const first = pipelineOptions[0];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Pipelines</h1>
        <span className="flex flex-wrap items-center gap-2">
          <Link href="/settings" className="text-sm text-muted underline hover:text-ink">
            Edit stages
          </Link>
          {first ? (
            <Link
              href="/pipelines?new=1"
              className="rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
            >
              New deal
            </Link>
          ) : null}
        </span>
      </div>

      {editing || adding ? (
        <section
          aria-label={editing ? "Edit deal" : "New deal"}
          className="mb-8 rounded-[--radius-panel] border border-line bg-surface p-4"
        >
          <h2 className="mb-4 text-lg font-semibold">{editing ? "Deal" : "New deal"}</h2>
          <DealForm
            values={{
              id: editing?.id,
              title: editing?.title ?? "",
              pipelineId: editing?.pipelineId ?? first?.id ?? "",
              contactId: editing?.contactId ?? "",
              stage: editing?.stage ?? first?.stages[0] ?? "",
              value: editing ? centsToInput(editing.valueCents) : "",
              nextStep: editing?.nextStep ?? "",
              nextStepDue: editing?.nextStepDue ?? "",
              owner: editing?.owner ?? "Devon",
            }}
            pipelines={pipelineOptions}
            contacts={contacts}
            onDone="/pipelines"
          />
        </section>
      ) : null}

      {boards.length === 0 ? (
        <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
          No pipelines yet. Run the seed to create the starter pipelines.
        </p>
      ) : (
        boards.map((board) => <PipelineBoard key={board.pipeline.id} board={board} today={today} />)
      )}
    </div>
  );
}
