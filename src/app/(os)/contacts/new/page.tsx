import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { ContactForm } from "@/modules/crm/components/contact-form";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage() {
  await requireOwner();
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold">New contact</h1>
        <Link href="/contacts" className="text-sm text-muted underline hover:text-ink">
          Back to Contacts
        </Link>
      </div>
      <ContactForm
        values={{
          firstName: "",
          lastName: "",
          orgName: "",
          email: "",
          phone: "",
          types: [],
          tags: [],
          doNotContact: false,
        }}
      />
    </div>
  );
}
