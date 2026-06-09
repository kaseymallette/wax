import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Songs imported from the user's library
export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(), // Spotify track ID
  name: text("name").notNull(),
  artists: text("artists").notNull().default(""), // comma-joined
  album: text("album").notNull().default(""),
  albumArtUrl: text("album_art_url"),
  durationMs: integer("duration_ms"),
  addedAt: text("added_at"),
  spotifyUrl: text("spotify_url"),
  previewUrl: text("preview_url"),
  importedAt: integer("imported_at").notNull(),
  era: text("era"), // one of ERA_OPTIONS values or null. Sticky per track.
});

// One row per listen. A track can be listened to many times.
export const listens = sqliteTable("listens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id")
    .notNull()
    .references(() => tracks.id, { onDelete: "cascade" }),
  listened: integer("listened").notNull(), // 0 = no/background, 1 = yes/actually listened
  wouldAgain: integer("would_again").notNull(), // 0 = no, 1 = yes
  activity: text("activity").notNull().default("[]"), // JSON array of strings
  notes: text("notes").default(""),
  loggedAt: integer("logged_at").notNull(), // unix ms
});

// 9 activity presets. Do NOT add others.
export const ACTIVITY_PRESETS = [
  "working",
  "working out",
  "cleaning",
  "driving",
  "dancing",
  "singing",
  "active listening",
  "processing",
  "resting",
] as const;

export const ERA_OPTIONS = [
  { value: "recently_discovered", label: "Recently discovered" },
  { value: "recently_remembered", label: "Recently remembered" },
  { value: "core_spotify", label: "Core Spotify" },
  { value: "core_itunes", label: "Core iTunes" },
  { value: "core_cd", label: "Core CD" },
] as const;

export const ERA_VALUES = ERA_OPTIONS.map((e) => e.value) as [string, ...string[]];

export const insertTrackSchema = createInsertSchema(tracks);

// Listen payload accepted by the API
export const listenPayloadSchema = z.object({
  trackId: z.string().min(1),
  listened: z.union([z.boolean(), z.number().int().min(0).max(1)]),
  wouldAgain: z.union([z.boolean(), z.number().int().min(0).max(1)]),
  activity: z.array(z.string()).default([]),
  notes: z.string().default(""),
  era: z.enum(ERA_VALUES).nullable().optional(),
});

export const eraUpdateSchema = z.object({
  era: z.enum(ERA_VALUES),
});

export const trackImportSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  artists: z.string().default(""),
  album: z.string().default(""),
  albumArtUrl: z.string().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  addedAt: z.string().nullable().optional(),
  spotifyUrl: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
});

export type InsertTrack = z.infer<typeof insertTrackSchema>;
export type Track = typeof tracks.$inferSelect;
export type Listen = typeof listens.$inferSelect;
export type ListenPayload = z.infer<typeof listenPayloadSchema>;
export type TrackImport = z.infer<typeof trackImportSchema>;

// A track joined with aggregate listen data.
export type TrackWithStats = Track & {
  listenCount: number;
  actualListenCount: number;
  lastListenedAt: number | null;
  wouldAgainCount: number;
  wouldNotAgainCount: number;
};

// A listen joined with its track's display metadata.
export type ListenWithTrack = {
  id: number;
  trackId: string;
  listened: number;
  wouldAgain: number;
  activity: string[];
  notes: string;
  loggedAt: number;
  name: string;
  artists: string;
  album: string;
  albumArtUrl: string | null;
  spotifyUrl: string | null;
  previewUrl: string | null;
  era: string | null;
};
