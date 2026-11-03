import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { Importer } from "@/modules/import/components/importer";
import { hasModelKey } from "@/modules/import/model";

export const metadata: Metadata = { title: "Import schedule" };

export default async function ImportPage() {
  await requireOwner();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold">Import schedule</h1>
        <Link href="/schedule" className="text-sm text-muted underline hover:text-ink">
          Back to Schedule
        </Link>
      </div>
      <p className="mb-6 text-sm text-muted">
        Basketball events only. Nothing is saved until you have seen the preview and confirmed it, and importing the
        same file twice changes nothing.
      </p>
      <Importer modelAvailable={hasModelKey()} />
    </div>
  );
}
