import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { hasModelKey } from "@/lib/model";
import { Composer } from "@/modules/operator/components/composer";
import { Thread } from "@/modules/operator/components/thread";
import { listThreads, threadById, threadMessages } from "@/modules/operator/queries";
import { OFFLINE_MESSAGE } from "@/modules/operator/service";

export const metadata: Metadata = { title: "Operator" };

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const db = getDb();
  const params = await searchParams;

  const requested = Array.isArray(params.thread) ? params.thread[0] : params.thread;
  const [threads, thread] = await Promise.all([listThreads(db), requested ? threadById(db, requested) : null]);
  const messages = thread ? await threadMessages(db, thread.id) : [];
  const online = hasModelKey();

  const draftedApproval = messages.some(
    (message) => message.role === "tool" && message.toolName === "messages.draft" && message.toolStatus === "ok",
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-2 text-3xl font-semibold">Operator</h1>
      <p className="mb-6 text-sm text-muted">
        It can read everything and write tasks, events, notes, practice and stage moves. It cannot send anything:
        a message it drafts waits in Approvals for you.
      </p>

      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <nav aria-label="Threads" className="space-y-1">
          <Link
            href="/operator"
            aria-current={thread ? undefined : "page"}
            className="block rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent aria-[current=page]:border-accent aria-[current=page]:text-accent"
          >
            New thread
          </Link>
          {threads.map((row) => (
            <Link
              key={row.id}
              href={`/operator?thread=${row.id}`}
              aria-current={thread?.id === row.id ? "page" : undefined}
              className="block rounded-[--radius-control] px-3 py-1.5 text-sm text-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-accent"
            >
              {row.title}
            </Link>
          ))}
          {threads.length === 0 ? <p className="px-3 py-1.5 text-xs text-muted">No threads yet.</p> : null}
        </nav>

        <section>
          <Thread messages={messages} draftedApproval={draftedApproval} />

          {online ? (
            <Composer threadId={thread?.id ?? null} />
          ) : (
            <p className="mt-4 rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
              {OFFLINE_MESSAGE} Everything else — capture, the schedule, approvals and the morning brief — keeps
              working without it.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
