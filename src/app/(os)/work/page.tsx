import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { FilterBar } from "@/modules/work/components/filters";
import { MiscInbox } from "@/modules/work/components/inbox";
import { TaskCard } from "@/modules/work/components/task-card";
import { TaskDrawer } from "@/modules/work/components/task-drawer";
import { filtersToQuery, parseFilters } from "@/modules/work/filters";
import {
  boardTasks,
  groupByColumn,
  listBoards,
  listTasks,
  miscInbox,
  projectOptions,
  taskById,
  type Task,
} from "@/modules/work/queries";
import { contactOptions, dealOptions } from "@/modules/crm/queries";

export const metadata: Metadata = { title: "Work" };

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
      {children}
    </p>
  );
}

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const db = getDb();
  const { timezone } = await getSettings();
  const today = dateInZone(new Date(), timezone);

  const filters = parseFilters(await searchParams);
  const [inbox, boards, projects, contacts, dealList] = await Promise.all([
    miscInbox(db),
    listBoards(db),
    projectOptions(db),
    contactOptions(db),
    dealOptions(db),
  ]);

  // The board picker defaults to the first board rather than leaving the view empty.
  const activeBoard = boards.find((board) => board.id === filters.board) ?? boards[0] ?? null;
  const resolved = { ...filters, board: activeBoard?.id ?? null };

  const groups =
    resolved.view === "board" && activeBoard
      ? groupByColumn(activeBoard, await boardTasks(db, activeBoard.id, resolved, today))
      : [];
  const rows: Task[] = resolved.view === "list" ? await listTasks(db, resolved, today) : [];

  const open = filters.task ? await taskById(db, filters.task) : null;
  const columnsFor = (task: Task) => boards.find((board) => board.id === task.boardId)?.columns ?? [];
  const projectName = (task: Task) => projects.find((project) => project.id === task.projectId)?.name;
  const drawerHref = (task: Task) => `/work${filtersToQuery(resolved, { task: task.id })}`;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-3xl font-semibold">Work</h1>

      <MiscInbox items={inbox} boards={boards} />

      <FilterBar filters={resolved} boards={boards} />

      <div className={open ? "grid gap-6 lg:grid-cols-[1fr_380px]" : ""}>
        <div className="min-w-0">
          {resolved.view === "board" ? (
            !activeBoard ? (
              <EmptyState>No boards yet. Run the seed to create the starter boards.</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {groups.map((group) => (
                  <section key={group.column} aria-labelledby={`column-${group.column}`}>
                    <h2
                      id={`column-${group.column}`}
                      className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink"
                    >
                      {group.column}
                      <span className="font-mono text-xs text-muted">{group.tasks.length}</span>
                      {group.known ? null : (
                        <span className="text-xs font-normal text-muted/70">not on this board</span>
                      )}
                    </h2>
                    <div className="space-y-2">
                      {group.tasks.length === 0 ? (
                        <p className="rounded-[--radius-panel] border border-dashed border-line px-3 py-4 text-xs text-muted">
                          Nothing here.
                        </p>
                      ) : (
                        group.tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            columns={activeBoard.columns}
                            today={today}
                            drawerHref={drawerHref(task)}
                            projectName={projectName(task)}
                          />
                        ))
                      )}
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : rows.length === 0 ? (
            <EmptyState>
              No tasks match these filters. Capture something, or{" "}
              <Link href="/work" className="underline hover:text-ink">
                clear the filters
              </Link>
              .
            </EmptyState>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  columns={columnsFor(task)}
                  today={today}
                  drawerHref={drawerHref(task)}
                  projectName={projectName(task)}
                />
              ))}
            </div>
          )}
        </div>

        {open ? (
          <TaskDrawer
            task={open}
            boards={boards}
            projects={projects}
            contacts={contacts}
            deals={dealList}
            closeHref={`/work${filtersToQuery(resolved, { task: null })}`}
          />
        ) : null}
      </div>
    </div>
  );
}
