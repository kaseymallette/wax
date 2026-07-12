import { ACTIVITY_PRESETS } from "@shared/schema";

export const PRESETS: readonly string[] = ACTIVITY_PRESETS;

export function isPreset(tag: string): boolean {
  return PRESETS.includes(tag);
}

export function repeatIntentLabel(intent: string | null | undefined): string {
  if (intent === "undecided") return "Undecided";
  if (intent === "currently_listening") return "Currently Listening";
  if (intent === "favorites_archive") return "Favorites Archive";
  if (intent === "save_for_later") return "Save for Later";
  if (intent === "skip_for_now") return "Skip for Now";
  return "Undecided";
}

export function repeatIntentChipClass(intent: string | null | undefined): string {
  if (intent === "undecided") return "bg-secondary/60 text-muted-foreground";
  if (intent === "currently_listening") return "bg-blue-500/15 text-blue-400";
  if (intent === "favorites_archive") return "bg-emerald-500/15 text-emerald-400";
  if (intent === "save_for_later") return "bg-amber-500/15 text-amber-400";
  if (intent === "skip_for_now") return "bg-destructive/15 text-destructive";
  return "bg-secondary/60 text-muted-foreground";
}

// Relative time, e.g. "2h ago", "yesterday", "3 days ago".
export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

// Absolute time, e.g. "Jun 8 · 1:23 AM".
export function absoluteTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

// Day-group header label: "Today", "Yesterday", or "Jun 6, 2026".
export function dayHeader(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
