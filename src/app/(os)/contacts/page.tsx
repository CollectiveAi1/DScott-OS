import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { searchContacts } from "@/modules/crm/queries";
import { CONTACT_TYPES, contactName } from "@/modules/crm/service";

export const metadata: Metadata = { title: "Contacts" };

function one(params: Record<string, string | string[] | undefined>, key: string): string[] {
  const value = params[key];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const params = await searchParams;
  const query = one(params, "q")[0] ?? "";
  const types = one(params, "type").filter((type) => (CONTACT_TYPES as readonly string[]).includes(type));

  const rows = await searchContacts(getDb(), { query, types });
  const filtered = Boolean(query) || types.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Contacts</h1>
        <Link
          href="/contacts/new"
          className="rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          New contact
        </Link>
      </div>

      <form method="get" action="/contacts" className="mb-6 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Search</span>
          <input
            name="q"
            defaultValue={query}
            placeholder="Name, email, phone, organisation or tag"
            className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-xs uppercase tracking-wider text-muted">Type</legend>
          <div className="flex flex-wrap gap-3">
            {CONTACT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  name="type"
                  value={type}
                  defaultChecked={types.includes(type)}
                  className="accent-[--color-accent]"
                />
                {type}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
          >
            Search
          </button>
          {filtered ? (
            <Link href="/contacts" className="text-sm text-muted underline hover:text-ink">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
          {filtered ? "Nobody matches that." : "No contacts yet. Everyone Devon deals with lives here."}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
          {rows.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/contacts/${contact.id}`} className="text-sm text-ink hover:text-accent">
                  {contactName(contact)}
                </Link>
                <p className="text-xs text-muted">
                  {[contact.orgName, contact.email, contact.phone].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {contact.doNotContact ? (
                  <span className="rounded-[--radius-control] border border-danger px-1.5 py-0.5 text-[11px] text-danger">
                    Do not contact
                  </span>
                ) : null}
                {contact.types.map((type) => (
                  <span key={type} className="rounded-[--radius-control] border border-line-strong px-1.5 py-0.5 text-[11px] text-muted">
                    {type}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
