import { Sidebar } from "@/components/sidebar";
import { signOutAction } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

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
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
