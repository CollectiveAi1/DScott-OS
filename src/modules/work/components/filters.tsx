import Link from "next/link";
import { Select } from "@/components/form";
import {
  ARENA_OPTIONS,
  DUE_OPTIONS,
  filtersToQuery,
  hasActiveFilters,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type WorkFilters,
} from "../filters";
import type { Board } from "../queries";

/**
 * A real GET form: the whole view lives in the URL, so a filtered board is shareable, survives a
 * refresh and works with the back button. No client state to desynchronise.
 */
export function FilterBar({ filters, boards }: { filters: WorkFilters; boards: Board[] }) {
  const other = filters.view === "board" ? "list" : "board";
  const showBoardPicker = filters.view === "board" && boards.length > 1;

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/work${filtersToQuery(filters, { view: other, task: null })}`}
          className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
        >
          {other === "list" ? "List view" : "Board view"}
        </Link>
        <Link
          href="/work/projects"
          className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
        >
          Projects
        </Link>
        {hasActiveFilters(filters) ? (
          <Link
            href={`/work${filtersToQuery(filters, { arena: "any", priority: "any", due: "any", status: "open" })}`}
            className="text-sm text-muted underline hover:text-ink"
          >
            Clear filters
          </Link>
        ) : null}
      </div>

      <form method="get" action="/work" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={filters.view} />
        {/* The board is either a visible picker or a carried-through hidden value, never both. */}
        {showBoardPicker ? null : filters.board ? (
          <input type="hidden" name="board" value={filters.board} />
        ) : null}
        {showBoardPicker ? (
          <div className="w-44">
            <Select
              label="Board"
              name="board"
              compact
              options={boards.map((board) => ({ value: board.id, label: board.name }))}
              defaultValue={filters.board ?? boards[0]?.id}
            />
          </div>
        ) : null}
        <div className="w-40">
          <Select label="Arena" name="arena" compact options={[...ARENA_OPTIONS]} defaultValue={filters.arena} />
        </div>
        <div className="w-36">
          <Select label="Priority" name="priority" compact options={[...PRIORITY_OPTIONS]} defaultValue={filters.priority} />
        </div>
        <div className="w-36">
          <Select label="Due" name="due" compact options={[...DUE_OPTIONS]} defaultValue={filters.due} />
        </div>
        <div className="w-36">
          <Select label="Status" name="status" compact options={[...STATUS_OPTIONS]} defaultValue={filters.status} />
        </div>
        <button
          type="submit"
          className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
        >
          Apply
        </button>
      </form>
    </div>
  );
}
