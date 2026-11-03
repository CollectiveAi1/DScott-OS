const ARENA = {
  collective: { label: "Collective AI", color: "var(--color-arena-collective)" },
  basketball: { label: "Basketball", color: "var(--color-arena-basketball)" },
  family: { label: "Family", color: "var(--color-arena-family)" },
  misc: { label: "Misc", color: "var(--color-arena-misc)" },
} as const;

export type ArenaName = keyof typeof ARENA;

export function arenaLabel(arena: ArenaName): string {
  return ARENA[arena].label;
}

/**
 * The arena of a row. The dot is the colour and the word is the meaning: colour is never the
 * only signal (PRD §8.0), so this never renders as a bare swatch.
 */
export function ArenaTag({ arena }: { arena: ArenaName }) {
  const { label, color } = ARENA[arena];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
