import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { ProjectList } from "@/modules/work/components/projects";
import { listProjects } from "@/modules/work/queries";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requireOwner();
  const projects = await listProjects(getDb());

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold">Projects</h1>
        <Link href="/work" className="text-sm text-muted underline hover:text-ink">
          Back to Work
        </Link>
      </div>
      <ProjectList projects={projects} />
    </div>
  );
}
