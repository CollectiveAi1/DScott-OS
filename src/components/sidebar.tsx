"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Screen = { label: string; href?: string; ships?: "v1" | "v2" | "v3" };

// Screens without an href are planned, not built: shown so the map is visible, never as dead links.
const MENU: { group: string; screens: Screen[] }[] = [
  {
    group: "Daily",
    screens: [
      { label: "Command", href: "/" },
      { label: "Schedule", ships: "v1" },
      { label: "Operator", ships: "v1" },
      { label: "Approvals", ships: "v1" },
      { label: "Work", ships: "v1" },
    ],
  },
  {
    group: "Collective",
    screens: [
      { label: "Learning", ships: "v1" },
      { label: "Pipelines", ships: "v1" },
    ],
  },
  { group: "People", screens: [{ label: "Contacts", ships: "v1" }] },
  {
    group: "Growth",
    screens: [
      { label: "Outreach", ships: "v2" },
      { label: "Booking", ships: "v2" },
    ],
  },
  { group: "Studio", screens: [{ label: "Content", ships: "v3" }] },
  {
    group: "System",
    screens: [
      { label: "Agents", ships: "v3" },
      { label: "Settings", href: "/settings" },
    ],
  },
];

export function Sidebar({ mode }: { mode: "sandbox" | "live" }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-6 px-4 py-6">
      <Link href="/" className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
        DScott OS
      </Link>
      <Link
        href="/settings"
        className={`self-start rounded-[--radius-control] border px-2 py-1 font-mono text-[11px] uppercase tracking-wider ${
          mode === "live" ? "border-accent text-accent" : "border-line-strong text-muted"
        }`}
      >
        {mode === "live" ? "Live delivery" : "Sandbox · nothing sends"}
      </Link>
      {MENU.map(({ group, screens }) => (
        <div key={group}>
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{group}</p>
          <ul className="space-y-0.5">
            {screens.map((screen) => (
              <li key={screen.label}>
                {screen.href ? (
                  <Link
                    href={screen.href}
                    aria-current={pathname === screen.href ? "page" : undefined}
                    className="block rounded-[--radius-control] px-2 py-1.5 text-sm text-ink hover:bg-surface-raised aria-[current=page]:bg-surface-raised aria-[current=page]:text-accent"
                  >
                    {screen.label}
                  </Link>
                ) : (
                  <span className="flex items-center justify-between px-2 py-1.5 text-sm text-muted/60">
                    {screen.label}
                    <span className="font-mono text-[10px]">{screen.ships}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
