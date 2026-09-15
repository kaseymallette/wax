# BUILD PLAN — Wax V2 (Authoritative Rewrite)

## Source of truth

This plan is aligned to `docs/WAX_V2_README.md` and treats it as the product and architecture specification.

---

## Scope lock (what V2 is and is not)

V2 is a playlist-generation app, not a music-library management app.

In scope:

- user config with any number of profiles,
- one authoritative master CSV path per profile,
- full upfront validation before workflow access,
- one local app session with one-profile-at-a-time review,
- 7 balanced daily playlists per profile (`k = 7`),
- center-nearest initial first track, then KNN ordering,
- immediate KNN reordering when user picks another first track,
- Spotify preview + Spotify publish,
- per-profile weekly snapshot on publish,
- single Wax Weekly build only after all profiles have completed snapshots,
- deployment by explicit review/commit/push of generated site data.

Out of scope:

- persistent music-library curation system,
- listening-state taxonomy (`currently_listening`, `favorites_archive`, `save_for_later`, `skip_for_now`, etc.),
- decision history UX,
- direct Spotify source-playlist ingestion (future scope; CSV remains source input for V2).

---

## Repository conflicts with the V2 spec (must be resolved, not carried forward)

1. **V1 state model is currently foundational**  
   The backend storage and APIs are built around persistent library tables + repeat-intent/listen history (`server/storage.ts`, `server/routes.ts`), but V2 explicitly removes this model.

2. **Current daily playlist algorithm has a hard cap path that can drop tracks**  
   `server/dailyPlaylists.ts` enforces tiered max playlist sizes and can increment `droppedForCapacity`; V2 requires every track from a valid CSV be assigned with balanced sizes and no truncation/drop.

3. **Current inputs are filtered by V1 state fields**  
   `buildDailyPlaylists` filters by `repeatIntent === currently_listening` and `dailyPlaylistStatus !== review`; V2 input must be the full profile CSV (70–700 tracks) with no V1 listening-state gating.

4. **Current publish script pushes non-V2 playlists**  
   `script/pushSpotify.ts` includes `currently-listening`, `favorites-archive`, `save-for-later`, `skip-for-now`, and `full-music-library`; V2 publish must be profile-specific seven daily playlists only.

5. **Current UI/app shell still exposes removed V1 features**  
   Router/nav include Import, Evaluate, Shuffle, Library, Recents, Keeps, Stats (`client/src/App.tsx`, `client/src/components/Layout.tsx`), all out of V2 scope.

6. **Current weekly tooling is user-list driven, not config-completion driven**  
   `script/captureWeeklyDailyPlaylists.ts` takes a user list and processes available dirs; V2 requires per-profile snapshot completion tracking and one final build trigger after all configured profiles complete.

---

## Explicit V1 components to delete

Delete these components as part of implementation (not preserve/migrate):

- V1 pages and navigation:
  - `client/src/pages/ImportPage.tsx`
  - `client/src/pages/EvaluatePage.tsx`
  - `client/src/pages/Shuffle.tsx`
  - `client/src/pages/LibraryPage.tsx`
  - `client/src/pages/RecentsPage.tsx`
  - `client/src/pages/KeepsPage.tsx`
  - `client/src/pages/StatsPage.tsx`
  - related route/nav wiring in `client/src/App.tsx` and `client/src/components/Layout.tsx`
- V1 API surface:
  - upload/import endpoints,
  - tracks/listens/repeat-intent endpoints,
  - V1 stats endpoints.
- V1 persistent data model + scripts:
  - persistent library/listen/repeat-intent oriented storage flow in `server/storage.ts`,
  - scripts dedicated to library/decision lifecycle (`decisions:*`, `user:import`, `user:remove`, `user:dupes`, library backup/restore lifecycle tied to V1 model, etc.).

Note: keep and reuse algorithm/publish/snapshot code paths only where behavior matches V2 after refactor.

---

## Target runtime model (no new profile-directory hierarchy)

- Keep one user-level config file defining all profiles (name + master CSV path, with optional publish metadata like station ID).
- Validate all configured CSVs before opening playlist workflow.
- Keep runtime artifacts profile-scoped by ID using filenames/keys, not a new nested profile directory tree.
- Keep local app running while user switches profile context in-app.

Example config shape (final schema to implement in code phase):

```json
{
  "profiles": [
    {
      "id": "alt-rock",
      "name": "Alt Rock",
      "masterCsvPath": "imports/alt-rock-master.csv",
      "stationId": "kasey-alt-rock",
      "enabled": true
    }
  ]
}
```

Validation rules:

- every enabled profile CSV must exist and parse,
- each CSV track count must be `70 <= n <= 700`,
- any invalid CSV blocks workflow startup and reports:
  - profile name,
  - CSV path,
  - actual count,
  - required range (`70–700`),
- no auto-truncate, repair, archive, or splitting.

---

## Implementation phases (execution order)

## Phase 1 — Remove V1 product surface and data model

### Work

- Remove V1-only pages, routes, and nav entries from frontend shell.
- Remove V1-only backend endpoints (library/import/listen/stats/repeat-intent flows).
- Replace V1 storage contract with a V2 profile-workflow contract centered on:
  - config,
  - profile playlist generation state,
  - profile publish/snapshot completion state.
- Remove V1 scripts/commands that rely on persistent library-management lifecycle.

### Tests in phase

- Frontend route tests: only V2 routes render.
- API contract tests: removed V1 endpoints return not found.
- Typecheck/build tests pass after deletions.

### Deliverables

- App shell exposes only V2 workflow surfaces.
- Server no longer requires V1 track/listen/repeat-intent schema to boot.

### Exit criteria

- No UI path remains for Import/Evaluate/Shuffle/Library/Recents/Keeps/Stats.
- No runtime dependency on V1 persistent listening-state data.

---

## Phase 2 — Profile config + global preflight validation gate

### Work

- Implement user profile config loader and schema validation.
- Implement CSV parser for authoritative master CSV input.
- Add startup/preflight validation that checks all enabled profiles before app workflow is available.
- Add structured validation report for invalid profiles and stop workflow when any fail.

### Tests in phase

- Unit tests for config schema (missing fields, duplicate IDs, invalid paths).
- Unit tests for CSV counting edge cases (`69`, `70`, `700`, `701`).
- Integration test: one invalid profile blocks all profile workflow access.

### Deliverables

- deterministic preflight validator,
- clear error payload/report with profile, path, actual count, required range.

### Exit criteria

- Workflow opens only when all enabled profiles pass.
- Validation never mutates source CSVs.

---

## Phase 3 — V2 clustering and ordering engine compliance

### Work

- Refactor/reuse `server/dailyPlaylists.ts` logic to meet exact V2 behavior:
  - `k = 7` clusters for valid profiles,
  - Mood uses cumulative `Energy + Danceability + Valence` with `0–300` semantic range,
  - balanced assignment built into clustering so all tracks are allocated,
  - playlist size targets follow `q = floor(n/7)`, `r = n mod 7`, sizes differ by at most one,
  - remove tiered cap and any dropped-track path.
- Keep center-nearest initial first-track logic.
- Keep immediate KNN reorder when first-track selection changes.

### Tests in phase

- Algorithm tests for size-balance invariants across representative `n` values.
- Regression tests proving no `dropped`/unassigned tracks for valid inputs.
- Ordering tests:
  - default start = center-nearest track,
  - selecting another first track recalculates order immediately.

### Deliverables

- spec-compliant cluster + order service operating on full profile CSV input.

### Exit criteria

- For any valid CSV, all tracks appear exactly once across seven playlists.
- Largest and smallest playlist lengths differ by at most one.

---

## Phase 4 — Profile navigation workflow in local app

### Work

- Add profile list API from validated config.
- Add profile selection state to playlist workflow APIs and UI.
- Implement one-profile-at-a-time review flow inside one app session.
- Keep Spotify preview integrated in review workflow.
- Enforce verification gate: profile publish action disabled until all seven playlists for the current profile are marked verified.

### Tests in phase

- Integration tests for profile switching with isolated state.
- UI tests for verify gating and publish-button enablement.
- Cache-key tests to prevent cross-profile data bleed.

### Deliverables

- V2 local app: configure once, navigate profiles, verify playlists per profile.

### Exit criteria

- User can review profiles sequentially without restarting app.
- Verification state is profile-scoped and durable for the session/store design.

---

## Phase 5 — Per-profile publish pipeline with retry and partial-failure safety

### Work

- Build a profile publish action that executes, in order, for current profile:
  1) generate 7 daily playlist CSV outputs,
  2) push 7 daily playlists to Spotify,
  3) capture the profile weekly snapshot.
- Reuse/refactor existing Spotify push and snapshot behavior where compatible, removing V1 extra playlist outputs.
- Implement robust failure model:
  - bounded retries for transient Spotify/API failures (401 refresh, 429 backoff, network retry),
  - step-level idempotency so rerun continues safely,
  - persist per-step status (`csv_done`, `spotify_done`, `snapshot_done`) for safe retry.
- Partial-failure behavior:
  - if Spotify push fails after CSV generation, keep app running, surface profile error status, allow retry publish for that profile only,
  - if snapshot fails after Spotify success, allow snapshot retry without redoing successful Spotify replacement unless requested.

### Tests in phase

- Integration tests for publish happy path.
- Fault-injection tests for retries/backoff.
- Resume/retry tests for partial completion states.

### Deliverables

- profile-level publish operation that is recoverable and non-blocking to app session.

### Exit criteria

- Retrying a failed profile publish is safe and does not corrupt already successful steps.
- Publish output includes profile-specific status and diagnostics.

---

## Phase 6 — Completion gate and one-time Wax Weekly build

### Work

- Track snapshot completion across all configured enabled profiles.
- Add completion gate: Wax Weekly build endpoint/script only allowed when all profiles have completed snapshots for target week.
- Reuse/refactor existing weekly build (`script/buildWaxWeeklyData.ts`) to consume profile completion set from config-driven stations.
- Preserve explicit deployment step outside app automation: review generated data, commit, push.

### Tests in phase

- Gate tests: build blocked when any enabled profile lacks snapshot.
- Build tests: once all complete, one build generates expected data shape.
- Regression test: existing Wax Weekly frontend data contract remains compatible.

### Deliverables

- final aggregation step that runs exactly once per full profile cycle.

### Exit criteria

- Build is unavailable/inactive until all enabled profiles complete snapshots.
- After completion, single build succeeds and outputs reviewable site data.

---

## Phase 7 — Final hardening and operator docs updates

### Work

- Remove obsolete scripts/commands from `package.json`.
- Add V2 operational runbook:
  - configure profiles,
  - run app,
  - validate all,
  - review/publish each profile,
  - build weekly once,
  - review/commit/push generated site data.
- Document known future scope item: direct Spotify source ingestion (not in V2).

### Tests in phase

- Full end-to-end smoke test over at least two profiles.
- Dry-run/real-run publish operator checks.
- CI check that no deleted V1 entrypoints remain referenced.

### Deliverables

- clean V2-only command surface and docs.

### Exit criteria

- No obsolete V1 command remains as a primary workflow path.
- Team can execute V2 weekly cycle from docs without V1 concepts.

---

## Done definition

V2 is complete when:

- V1 library-management architecture and UI/API surface are removed.
- A single validated config governs all profiles and blocks workflow on any invalid CSV.
- Each valid profile generates 7 balanced playlists using all source tracks and KNN ordering with immediate first-track reordering.
- Per-profile publish performs CSV generation + Spotify push + snapshot with safe retries and partial-failure recovery.
- Wax Weekly data build runs once only after every configured profile snapshot is complete.
- Deployment remains explicit review/commit/push of generated site data.
