import { useState } from "react";
import { ACTIVITY_PRESETS } from "@shared/schema";
import { isPreset } from "@/lib/wax";
import { Input } from "@/components/ui/input";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, X, Plus } from "lucide-react";

export type LogState = {
  listened: boolean | null;
  repeatIntent: "undecided" | "currently_listening" | "favorites_archive" | "save_for_later" | "skip" | null;
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

      {state.keepInLibrary === true && (
        <div className="space-y-2">
          <label className="text-sm font-semibold">Add it to...</label>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => patch({ repeatIntent: "favorites_archive" })}
                data-testid="button-repeat-favorites-archive"
                className={`w-full rounded-lg border px-3 py-2.5 pl-9 text-sm font-medium transition-colors hover-elevate ${
                  state.repeatIntent === "favorites_archive" ? SEG_ACTIVE : SEG_IDLE
                }`}
              >
                Favorites Archive
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About Favorites Archive"
                    data-testid="button-info-favorites-archive"
                    className="absolute left-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>You loved it so much it needs a nap.</TooltipContent>
              </Tooltip>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => patch({ repeatIntent: "save_for_later" })}
                data-testid="button-repeat-save-for-later"
                className={`w-full rounded-lg border px-3 py-2.5 pl-9 text-sm font-medium transition-colors hover-elevate ${
                  state.repeatIntent === "save_for_later" ? SEG_ACTIVE : SEG_IDLE
                }`}
              >
                Save For Later
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About Save For Later"
                    data-testid="button-info-save-for-later"
                    className="absolute left-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Could be good, not sure yet.</TooltipContent>
              </Tooltip>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => patch({ repeatIntent: "currently_listening" })}
                data-testid="button-repeat-currently-listening"
                className={`w-full rounded-lg border px-3 py-2.5 pl-9 text-sm font-medium transition-colors hover-elevate ${
                  state.repeatIntent === "currently_listening" ? SEG_ACTIVE : SEG_IDLE
                }`}
              >
                Currently Listening
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About Currently Listening"
                    data-testid="button-info-currently-listening"
                    className="absolute left-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>You want to hear it again and again.</TooltipContent>
              </Tooltip>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => patch({ repeatIntent: "skip" })}
                data-testid="button-repeat-skip"
                className={`w-full rounded-lg border px-3 py-2.5 pl-9 text-sm font-medium transition-colors hover-elevate ${
                  state.repeatIntent === "skip" ? SEG_ACTIVE : SEG_IDLE
                }`}
              >
                Skip
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About Skip"
                    data-testid="button-info-skip"
                    className="absolute left-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>You're just not feeling it.</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70">
            Only songs in Currently Listening are used to build Spotify playlists.
          </p>
        </div>
      )}

      {state.keepInLibrary === true && (
        <div className="space-y-2">
          <label className="text-sm font-semibold">When to listen (optional)</label>
          <div className="grid grid-cols-5 gap-1.5">
            {ACTIVITY_PRESETS.map((tag, i) => {
              const active = state.activity.includes(tag);
              return (
                <Tooltip key={tag}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleActivity(tag)}
                      data-testid={`chip-activity-${tag.replace(/\s+/g, "-")}`}
                      className={`w-full rounded-full border px-2 py-1 text-xs font-medium transition-colors hover-elevate ${
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
      )}

    </div>
  );
}
