import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { ApprovalCard } from "@/modules/approvals/components/card";
import { isTab, listApprovals, TAB_LABEL, TABS, tabCounts, type Tab } from "@/modules/approvals/queries";
import { hasRealProvider } from "@/modules/approvals/providers";

export const metadata: Metadata = { title: "Approvals" };

const EMPTY: Record<Tab, string> = {
  waiting: "Nothing waiting. Anything the Operator or an automation drafts lands here for your yes.",
  scheduled: "Nothing scheduled. Approving in live mode queues a message for delivery.",
  failed: "Nothing has failed.",
  history: "Nothing decided yet.",
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const db = getDb();
  const { deliveryMode } = await getSettings();
  const params = await searchParams;

  const requested = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab = isTab(requested) ? requested : "waiting";

  const [rows, counts] = await Promise.all([listApprovals(db, tab), tabCounts(db)]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-2 text-3xl font-semibold">Approvals</h1>
      <p className="mb-6 text-sm text-muted">
        {deliveryMode === "sandbox"
          ? "Sandbox. Approving records the decision and delivers nothing."
          : "Live. Approved items are queued for delivery."}
        {hasRealProvider() ? "" : " No provider is connected, so nothing can be sent in this version."}
      </p>

      <nav aria-label="Approvals" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((name) => (
          <Link
            key={name}
            href={name === "waiting" ? "/approvals" : `/approvals?tab=${name}`}
            aria-current={tab === name ? "page" : undefined}
            className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent aria-[current=page]:border-accent aria-[current=page]:text-accent"
          >
            {TAB_LABEL[name]}
            <span className="ml-2 font-mono text-xs text-muted">{counts[name]}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
          {EMPTY[tab]}
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} mode={deliveryMode} />
          ))}
        </div>
      )}
    </div>
  );
}
