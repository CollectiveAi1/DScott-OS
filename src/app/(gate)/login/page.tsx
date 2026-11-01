import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentOwner, ownerExists } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await ownerExists())) redirect("/setup");
  if (await currentOwner()) redirect("/");
  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mb-8 mt-2 text-sm text-muted">Sign in to pick up where you left off.</p>
      <LoginForm />
    </>
  );
}
