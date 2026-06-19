import { useState } from "react";
import { ACTIVITY_PRESETS } from "@shared/schema";
import { isPreset } from "@/lib/wax";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Headphones, EarOff, X, Plus } from "lucide-react";

export type LogState = {
  listened: boolean | null;
  repeatIntent: "undecided" | "on_repeat" | "yes" | "maybe" | "nah" | null;
  keepInLibrary: boolean | null;
  activity: string[];
  notes: string;
};

export function initialLogState(): LogState {
  return {
    listened: null,
    repeatIntent: null,
    keepInLibrary: null,
    activity: [],
    notes: "",
  };
}

export function isLogValid(state: LogState): boolean {
  if (state.keepInLibrary === null) return false;
  if (state.listened === null) return false;
  if (state.keepInLibrary === false) return true;
  return state.repeatIntent !== null;
}

const SEG_BASE =
  "flex items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors hover-elevate";
const SEG_ACTIVE = "border-primary bg-primary/15 text-primary";
const SEG_IDLE = "border-border bg-secondary/40 text-muted-foreground";

export function LogForm({
  state,
  setState,
}: {
  state: LogState;
  setState: (s: LogState) => void;
}) {
  const [customInput, setCustomInput] = useState("");
  const patch = (p: Partial<LogState>) => setState({ ...state, ...p });

  const toggleActivity = (tag: string) =>
    state.activity.includes(tag)
      ? patch({ activity: state.activity.filter((x) => x !== tag) })
      : patch({ activity: [...state.activity, tag] });

  const addCustom = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (!t) return;
    if (!state.activity.includes(t)) patch({ activity: [...state.activity, t] });
  };

  const customTags = state.activity.filter((t) => !isPreset(t));

  return (
    <div className="space-y-6">
      {/* Keep/remove library flag (required) */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">Keep or remove from library? (required)</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ keepInLibrary: true })}
            data-testid="button-keep-library"
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover-elevate ${
              state.keepInLibrary === true ? SEG_ACTIVE : SEG_IDLE
            }`}
          >
            Keep
          </button>
          <button
            type="button"
            onClick={() => patch({ keepInLibrary: false, repeatIntent: null })}
            data-testid="button-remove-library"
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover-elevate ${
              state.keepInLibrary === false ? SEG_ACTIVE : SEG_IDLE
            }`}
          >
            Remove
          </button>
        </div>
        <p className="text-xs text-muted-foreground/70">
          This only logs your preference. It does not delete tracks from your library.
        </p>
      </div>

      {/* Did you actually listen? */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">Did you actually listen?</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ listened: true })}
            data-testid="button-listened-yes"
            className={`${SEG_BASE} ${state.listened === true ? SEG_ACTIVE : SEG_IDLE}`}
          >
            <Headphones className="h-5 w-5" /> Listened
          </button>
          <button
            type="button"
            onClick={() => patch({ listened: false })}
            data-testid="button-listened-no"
            className={`${SEG_BASE} ${state.listened === false ? SEG_ACTIVE : SEG_IDLE}`}
          >
            <EarOff className="h-5 w-5" /> Background
          </button>
        </div>
      </div>

      {state.keepInLibrary === true && (
        <div className="space-y-2">
          <label className="text-sm font-semibold">Do you want to listen again?</label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => patch({ repeatIntent: "on_repeat" })}
              data-testid="button-repeat-on-repeat"
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover-elevate ${
                state.repeatIntent === "on_repeat" ? SEG_ACTIVE : SEG_IDLE
              }`}
            >
              On repeat
            </button>
            <button
              type="button"
              onClick={() => patch({ repeatIntent: "yes" })}
              data-testid="button-repeat-yes"
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover-elevate ${
                state.repeatIntent === "yes" ? SEG_ACTIVE : SEG_IDLE
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => patch({ repeatIntent: "maybe" })}
              data-testid="button-repeat-maybe"
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover-elevate ${
                state.repeatIntent === "maybe" ? SEG_ACTIVE : SEG_IDLE
              }`}
            >
              Maybe
            </button>
            <button
              type="button"
              onClick={() => patch({ repeatIntent: "nah" })}
              data-testid="button-repeat-nah"
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover-elevate ${
                state.repeatIntent === "nah" ? SEG_ACTIVE : SEG_IDLE
              }`}
            >
              Nah, I&apos;m good
            </button>
            <button
              type="button"
              onClick={() => patch({ repeatIntent: "undecided" })}
              data-testid="button-repeat-undecided"
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover-elevate ${
                state.repeatIntent === "undecided" ? SEG_ACTIVE : SEG_IDLE
              }`}
            >
              Undecided
            </button>
          </div>
        </div>
      )}

      {/* What were you doing? */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">What were you doing?</label>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_PRESETS.map((tag, i) => {
            const active = state.activity.includes(tag);
            return (
              <Tooltip key={tag}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => toggleActivity(tag)}
                    data-testid={`chip-activity-${tag.replace(/\s+/g, "-")}`}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover-elevate ${
                      active
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border bg-secondary/30 text-muted-foreground"
                    }`}
                  >
                    {tag}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Press {i + 1}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {customTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="container-custom-activities">
            {customTags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full bg-chart-2/20 px-2.5 py-1 text-xs font-medium text-chart-2"
                data-testid={`chip-custom-${t.replace(/\s+/g, "-")}`}
              >
                {t}
                <button
                  type="button"
                  onClick={() => toggleActivity(t)}
                  aria-label={`Remove ${t}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                addCustom(customInput);
                setCustomInput("");
              }
            }}
            placeholder="Add custom activity"
            className="pl-8"
            data-testid="input-custom-activity"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">Notes</label>
        <Textarea
          rows={3}
          value={state.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Anything you want to remember about this listen…"
          data-testid="textarea-notes"
        />
      </div>
    </div>
  );
}
