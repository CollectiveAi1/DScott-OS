import { Sidebar } from "@/components/sidebar";
import { signOutAction } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { QuickCapture } from "@/modules/work/components/quick-capture";

export const dynamic = "force-dynamic";

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await requireOwner();
  const { deliveryMode } = await getSettings();
  return (
    <div className="grid min-h-dvh md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-surface md:border-b-0 md:border-r">
        <Sidebar mode={deliveryMode} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-line px-6 py-3 text-sm text-muted">
          <span>{signedIn.name}</span>
          <form action={signOutAction}>
            <button type="submit" className="text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </header>
        {/* The bottom bar is fixed on phones, so the page needs room to scroll past it. */}
        <main className="flex-1 px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-8">{children}</main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 py-3 md:hidden">
        <QuickCapture variant="bar" />
      </div>
    </div>
  );
}
