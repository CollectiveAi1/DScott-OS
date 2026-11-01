import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/auth/session";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await ownerExists()) redirect("/login");
  return (
    <>
      <h1 className="text-2xl font-semibold">Set up your OS</h1>
      <p className="mb-8 mt-2 text-sm text-muted">One owner account. You only do this once.</p>
      <SetupForm />
    </>
  );
}
