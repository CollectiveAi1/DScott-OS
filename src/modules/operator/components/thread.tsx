import Link from "next/link";
import type { Message } from "../queries";

const ROLE_LABEL: Record<string, string> = { user: "You", assistant: "Operator", tool: "Tool" };

function text(message: Message): string {
  return String((message.content as { text?: unknown }).text ?? "");
}

/**
 * One tool call, collapsed.
 *
 * A plain `<details>`: the thread is readable, and every call is inspectable, with no JavaScript
 * involved. The summary line never contains a message body — that is in the approval, where it
 * can be edited before anyone sees it.
 */
function ToolCall({ message }: { message: Message }) {
  const content = message.content as { summary?: string; output?: unknown };
  const failed = message.toolStatus === "error";
  const error = failed ? (content.output as { error?: string } | undefined)?.error : null;

  return (
    <details className="rounded-[--radius-control] border border-line bg-base px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted">
        <span className="font-mono text-ink">{message.toolName}</span>
        {content.summary ? <span> · {content.summary}</span> : null}
        <span className={`ml-2 font-mono uppercase ${failed ? "text-danger" : "text-accent"}`}>
          {failed ? "error" : "ok"}
        </span>
      </summary>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted">
        {JSON.stringify(content.output ?? {}, null, 2)}
      </pre>
    </details>
  );
}

function Bubble({ message }: { message: Message }) {
  const mine = message.role === "user";
  return (
    <div className={mine ? "flex justify-end" : "block"}>
      <div
        className={`max-w-full rounded-[--radius-panel] px-4 py-3 ${
          mine ? "bg-surface-raised text-ink" : "border border-line bg-surface text-ink"
        }`}
      >
        <p className="mb-1 text-[11px] uppercase tracking-wider text-muted">{ROLE_LABEL[message.role]}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{text(message)}</p>
      </div>
    </div>
  );
}

/**
 * A whole thread. Tool calls are grouped under the assistant message they led to — which is why
 * they are rendered in order rather than filtered out: the sequence is the explanation.
 */
export function Thread({ messages, draftedApproval }: { messages: Message[]; draftedApproval: boolean }) {
  if (messages.length === 0) {
    return (
      <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
        Nothing said yet. Ask for the day, put something on the calendar, or have a message drafted.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((message) =>
        message.role === "tool" ? <ToolCall key={message.id} message={message} /> : <Bubble key={message.id} message={message} />,
      )}

      {draftedApproval ? (
        <p className="text-sm text-muted">
          Something in this thread was drafted.{" "}
          <Link href="/approvals" className="text-accent underline">
            It is waiting in Approvals
          </Link>{" "}
          until you approve it.
        </p>
      ) : null}
    </div>
  );
}
