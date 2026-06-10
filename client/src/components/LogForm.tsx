import { useState } from "react";
import { ACTIVITY_PRESETS, ERA_OPTIONS } from "@shared/schema";
import { isPreset } from "@/lib/wax";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Headphones, EarOff, ThumbsUp, ThumbsDown, X, Plus } from "lucide-react";

export type LogState = {
  era: string | null;
  listened: boolean | null;
  wantAgain: boolean | null;
  wouldAgain: boolean | null;
  keepInLibrary: boolean | null;
  activity: string[];
  notes: string;
};

export function initialLogState(era: string | null): LogState {
  return {
    era,
    listened: null,
    wantAgain: null,
    wouldAgain: null,
    keepInLibrary: null,
    activity: [],
    notes: "",
  };
}

export function isLogValid(state: LogState, needEra: boolean): boolean {
  if (needEra && !state.era) return false;
  return (
    state.listened !== null
    && state.wantAgain !== null
    && state.wouldAgain !== null
    && state.keepInLibrary !== null
  );
}

const SEG_BASE =
  "flex items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors hover-elevate";
const SEG_ACTIVE = "border-primary bg-primary/15 text-primary";
const SEG_IDLE = "border-border bg-secondary/40 text-muted-foreground";

export function LogForm({
  state,
  setState,
  showEra,
}: {
  state: LogState;
  setState: (s: LogState) => void;
  showEra: boolean;
}) {
  const [customInput, setCustomInput] = useState("");
  const [customEraInput, setCustomEraInput] = useState("");
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

  const setCustomEra = (raw: string) => {
    const era = raw.trim();
    if (!era) return;
    patch({ era: era.slice(0, 80) });
  };

  const commitCustomEra = () => {
    if (!customEraInput.trim()) return;
    setCustomEra(customEraInput);
    setCustomEraInput("");
  };

  const customTags = state.activity.filter((t) => !isPreset(t));

  return (
    <div className="space-y-6">
      {/* Era picker (first log only) */}
      {showEra && (
        <div className="space-y-2" data-testid="section-era">
          <label className="text-sm font-semibold">
            Which era of your life is this from?
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {ERA_OPTIONS.map((opt) => {
              const active = state.era === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => patch({ era: opt.value })}
                  data-testid={`radio-era-${opt.value}`}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors hover-elevate ${
                    active ? SEG_ACTIVE : SEG_IDLE
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      active ? "border-primary" : "border-muted-foreground/50"
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={customEraInput}
              onChange={(e) => setCustomEraInput(e.target.value)}
              onBlur={commitCustomEra}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  commitCustomEra();
                }
              }}
              placeholder="Add custom era"
              className="pl-8"
              data-testid="input-custom-era"
            />
          </div>
          <p className="text-xs text-muted-foreground/70">
            Set once per song — you can edit it later from Library.
          </p>
        </div>
      )}

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

      {/* Want to listen again? */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">Do you want to listen again?</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ wantAgain: true })}
            data-testid="button-want-again-yes"
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover-elevate ${
              state.wantAgain === true ? SEG_ACTIVE : SEG_IDLE
            }`}
          >
            <ThumbsUp className="h-4 w-4" /> Yes
          </button>
          <button
            type="button"
            onClick={() => patch({ wantAgain: false })}
            data-testid="button-want-again-no"
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover-elevate ${
              state.wantAgain === false ? SEG_ACTIVE : SEG_IDLE
            }`}
          >
            <ThumbsDown className="h-4 w-4" /> No
          </button>
        </div>
      </div>

      {/* Would you listen again? */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">Would you listen again?</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => patch({ wouldAgain: true })}
            data-testid="button-again-yes"
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover-elevate ${
              state.wouldAgain === true ? SEG_ACTIVE : SEG_IDLE
            }`}
          >
            <ThumbsUp className="h-4 w-4" /> Yes
          </button>
          <button
            type="button"
            onClick={() => patch({ wouldAgain: false })}
            data-testid="button-again-no"
            className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover-elevate ${
              state.wouldAgain === false ? SEG_ACTIVE : SEG_IDLE
            }`}
          >
            <ThumbsDown className="h-4 w-4" /> No
          </button>
        </div>
      </div>

      {/* Keep/remove library flag (logged only) */}
      <div className="space-y-2">
        <label className="text-sm font-semibold">Keep or remove from library?</label>
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
            onClick={() => patch({ keepInLibrary: false })}
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
