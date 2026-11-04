"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { updateStagesAction } from "../actions";

const initial: FormState = {};

export type PipelineSettings = { id: string; name: string; stages: string[]; billingStages: string[] };

function OnePipeline({ pipeline }: { pipeline: PipelineSettings }) {
  const [state, action, pending] = useActionState(updateStagesAction, initial);
  const [stages, setStages] = useState(pipeline.stages.join("\n"));
  const [billing, setBilling] = useState<string[]>(pipeline.billingStages);

  // Remounted on every settled submit: a checkbox React cannot diff back into place would
  // otherwise show the wrong billing stages after a refusal.
  const settled = useRef<FormState | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state === settled.current) return;
    settled.current = state;
    setRound((current) => current + 1);
  }, [state]);

  // The tick list follows what is typed above it, so a renamed stage can be ticked immediately.
  const available = stages
    .split("\n")
    .map((stage) => stage.trim())
    .filter(Boolean);

  const toggle = (stage: string) =>
    setBilling((current) => (current.includes(stage) ? current.filter((value) => value !== stage) : [...current, stage]));

  return (
    <form action={action} className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <input type="hidden" name="pipelineId" value={pipeline.id} />
      <h3 className="text-sm font-semibold text-ink">{pipeline.name}</h3>

      <label className="block">
        <span className="mb-1.5 block text-xs text-muted">Stages, one per line, in order</span>
        <textarea
          name="stages"
          rows={Math.max(4, available.length + 1)}
          value={stages}
          onChange={(event) => setStages(event.target.value)}
          className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
        <span className="mt-1 block text-xs text-muted">
          Renaming a stage moves the deals standing in it. A stage that still has deals cannot be removed.
        </span>
      </label>

      <fieldset key={`billing-${round}`}>
        <legend className="mb-1.5 text-xs text-muted">Billing stages — arriving here raises an invoice task for Ahmad</legend>
        <div className="flex flex-wrap gap-3">
          {available.length === 0 ? (
            <span className="text-xs text-muted">Add a stage first.</span>
          ) : (
            available.map((stage) => (
              <label key={stage} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  name="billingStages"
                  value={stage}
                  checked={billing.includes(stage)}
                  onChange={() => toggle(stage)}
                  className="accent-[--color-accent]"
                />
                {stage}
              </label>
            ))
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save stages"}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function PipelineSettingsPanel({ pipelines }: { pipelines: PipelineSettings[] }) {
  if (pipelines.length === 0) {
    return <p className="mt-4 text-sm text-muted">No pipelines yet. Run the seed to create the starter pipelines.</p>;
  }
  return (
    <div className="mt-4 space-y-6">
      {pipelines.map((pipeline) => (
        <OnePipeline key={pipeline.id} pipeline={pipeline} />
      ))}
    </div>
  );
}
