import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { ContactForm } from "@/modules/crm/components/contact-form";
import { LogEntry } from "@/modules/crm/components/log-entry";
import { formatCentsShort } from "@/modules/crm/money";
import {
  contactById,
  contactTimeline,
  dealsForContact,
  openTasksForContact,
  type TimelineItem,
} from "@/modules/crm/queries";
import { contactName } from "@/modules/crm/service";

export const metadata: Metadata = { title: "Contact" };

const KIND_LABEL: Record<TimelineItem["kind"], string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  stage_move: "Stage",
  task_done: "Task",
  approval: "Approval",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[--radius-panel] border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const db = getDb();
  const { timezone } = await getSettings();
  const { id } = await params;
  const query = await searchParams;

  const contact = await contactById(db, id);
  if (!contact) notFound();

  const cursorAt = typeof query.at === "string" ? query.at : null;
  const cursorId = typeof query.after === "string" ? query.after : null;
  const cursor = cursorAt && cursorId ? { at: cursorAt, id: cursorId } : null;

  const [deals, tasks, timeline] = await Promise.all([
    dealsForContact(db, id),
    openTasksForContact(db, id),
    contactTimeline(db, id, { cursor }),
  ]);

  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{contactName(contact)}</h1>
          <p className="mt-1 text-sm text-muted">
            {[contact.orgName, contact.email, contact.phone].filter(Boolean).join(" · ") || "No details yet"}
          </p>
        </div>
        <Link href="/contacts" className="text-sm text-muted underline hover:text-ink">
          Back to Contacts
        </Link>
      </div>

      {contact.doNotContact ? (
        <p role="status" className="mb-6 rounded-[--radius-panel] border border-danger px-4 py-3 text-sm text-danger">
          Do not contact. Nothing in the OS can draft a message to {contact.firstName} while this is set.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="History">
            <LogEntry contactId={contact.id} />
            {timeline.items.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                Nothing yet. Notes, calls, finished tasks and anything drafted to them all land here.
              </p>
            ) : (
              <ol className="mt-4 divide-y divide-line">
                {timeline.items.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className="py-3">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                      <span className="font-mono uppercase tracking-wider">{KIND_LABEL[item.kind]}</span>
                      <span>{when.format(item.at)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{item.body}</p>
                    {item.detail ? <p className="mt-0.5 text-xs text-danger">{item.detail}</p> : null}
                  </li>
                ))}
              </ol>
            )}
            {timeline.next ? (
              <Link
                href={`/contacts/${contact.id}?at=${encodeURIComponent(timeline.next.at)}&after=${timeline.next.id}`}
                className="mt-3 inline-block text-sm text-muted underline hover:text-ink"
              >
                Older
              </Link>
            ) : null}
            {cursor ? (
              <Link href={`/contacts/${contact.id}`} className="ml-4 mt-3 inline-block text-sm text-muted underline hover:text-ink">
                Back to the top
              </Link>
            ) : null}
          </Panel>

          <Panel title="Details">
            <ContactForm
              values={{
                id: contact.id,
                firstName: contact.firstName,
                lastName: contact.lastName ?? "",
                orgName: contact.orgName ?? "",
                email: contact.email ?? "",
                phone: contact.phone ?? "",
                types: contact.types,
                tags: contact.tags,
                doNotContact: contact.doNotContact,
              }}
            />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title={`Deals (${deals.length})`}>
            {deals.length === 0 ? (
              <p className="text-sm text-muted">No deals yet.</p>
            ) : (
              <ul className="space-y-2">
                {deals.map((deal) => (
                  <li key={deal.id} className="text-sm">
                    <Link href="/pipelines" className="text-ink hover:text-accent">
                      {deal.title}
                    </Link>
                    <span className="block font-mono text-xs text-muted">
                      {deal.stage} · {formatCentsShort(deal.valueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Open tasks (${tasks.length})`}>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted">Nothing open.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li key={task.id} className="text-sm">
                    <Link href={`/work?view=list&task=${task.id}`} className="text-ink hover:text-accent">
                      {task.title}
                    </Link>
                    <span className="block font-mono text-xs text-muted">
                      {task.owner}
                      {task.due ? ` · ${task.due}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
