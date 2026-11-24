# Wax Supervised Playlists

Status: Implemented as local commands

Updated: November 23, 2026

## Purpose

Update one Wax Weekly playlist after manually arranging it in Spotify. Spotify already has the desired songs and order. Wax matches that arrangement to its existing track metadata, prepares an export for review, and updates the website only when the reviewed playlist is ready.

This feature does not generate playlists, recluster the week, train a model, or publish changes back to Spotify. Work can happen one playlist at a time.

## Workflow

1. **Arrange in Spotify.** Reorder one daily playlist and remove any songs that should no longer be in it.
2. **Save the supervised CSV.** Place the CSV in `users/<username>/supervised/<export-folder>/<playlist>.csv`. Keep the corresponding export folder name so the source profile, week, and revision can be identified from its manifest.
3. **Prepare the review export.** Match the supervised CSV to the corresponding playlist by Spotify Track ID. Rewrite only that playlist's CSV in `users/<username>/exports/<export-folder>/`, preserving its existing columns and song metadata while applying the supervised membership and order. Renumber `rank` from 1. Preparing this file does not change Wax Weekly.
4. **Review the export.** Inspect the resulting CSV. Further Spotify edits can be imported again before updating the website. The export is intentionally a changed review copy, not an untouched original.
5. **Update Wax Weekly when ready.** A separate explicit action applies the reviewed export to that one website playlist and saves the accepted order for future rebuilds. Use the reviewed export, rather than rereading a potentially newer supervised CSV at this step.
6. **Deploy as usual.** Preparing or accepting a playlist does not automatically commit, push, or deploy the website.

## Commands

Run from the repository root. First prepare the review export:

```bash
npm run supervised:prepare -- users/kasey/supervised/alt-rock-2026-11-02-6729d0516bb1/alt-rock-monday.csv
```

Review the matching CSV under `users/kasey/exports/`. When ready, explicitly accept that export:

```bash
npm run supervised:accept -- users/kasey/exports/alt-rock-2026-11-02-6729d0516bb1/alt-rock-monday.csv
```

Append `--check` to either command to validate and preview the order without writing files. Both commands print the resulting order and omitted songs. Change the folder and filename to work on another playlist. No upload UI is implemented.

Preparation requires the matching export manifest and original published snapshot on this computer. Acceptance also requires the website to display the same week and Spotify playlist. The export must match the latest published source revision for that profile/week; unrelated profiles do not need to be republished. Metadata edits in a reviewed export are rejected: this workflow changes membership and order only.

Accepted orders are stored in `users/<username>/supervised/accepted.json`. Keep this file with the repository so `npm run weekly:release` can preserve accepted changes. Preparing another draft only rewrites its export; the saved acceptance remains intact. Repeating acceptance of the same order preserves its acceptance timestamp.

If a replacement snapshot conflicts with an accepted order, prepare and review the corresponding new export and accept it to replace that target's override. The website must already show the matching week and Spotify playlist. Overrides from other weeks are retained but do not affect the selected release.

## Matching and validation

The supervised CSV supplies song identities and order. Its columns can differ from the Wax export. Accept `Spotify Track Id` or `track_id`, and match exact Spotify IDs rather than titles or artist names. Preserve the existing export metadata; supervised feature values must not overwrite it.

Use `#` or `rank` when supplied, requiring unique contiguous positive positions starting at 1. If neither is present, use CSV row order. If both exist, require them to agree. Reject empty playlists, duplicate IDs, invalid ranks, ambiguous targets, and IDs absent from the original source playlist before changing files. Report the affected tracks so the input can be corrected.

Use exactly the songs in the supervised CSV. Omitted songs are removed from this daily playlist, not appended to the end or redistributed to other days. Their omission does not delete them from the master library or create a global dislike rule.

Repeated preparation must allow a previously omitted song to be restored when it belongs to the original playlist. Resolve its metadata from the unchanged source snapshot if it is no longer present in the review export. Validate all inputs before writing, and show the resulting song count, order, and removals for review.

## Saved state and rebuilds

Keep the original published snapshot unchanged as the record of the original playlist and its metadata. Keep the supervised CSV as the manual arrangement input and the changed export as the review artifact.

Store accepted website overrides separately, scoped to user, profile, week, day, and source snapshot revision. Record the reviewed ordered track IDs and an accepted revision. A prepared but unaccepted export must not affect the website, even during a full release build. Preparing another draft must not replace the last accepted website order.

A full Wax Weekly rebuild must apply accepted overrides after loading the matching published snapshots. Never silently apply an old override to a different week or source revision. If an override conflicts with a replacement snapshot for the same target, report it and require reconciliation.

Updating one playlist preserves its Spotify playlist URL and all other playlists. Recompute website counts and opener-dependent data from the accepted tracks. If its opener changes, remove any First Songs mix link that no longer matches; do not republish that Spotify mix. Website review and rebuilds must agree on the resulting playlist.

## Current example: Alt Rock Monday

The supervised input is [Alt Rock Monday](../../users/kasey/supervised/alt-rock-2026-11-02-6729d0516bb1/alt-rock-monday.csv). Its [review export](../../users/kasey/exports/alt-rock-2026-11-02-6729d0516bb1/alt-rock-monday.csv) already contains the chosen 32 songs in the manually arranged order, retaining the export's columns and metadata.

The original playlist had 35 songs. The three omitted songs are **Individualism — Anna Justen**, **It Matters To Me — Queen Cult**, and **Broken Mind — Hidden Pillars**. Keep the changed export for review; do not restore those songs there.

Local Wax Weekly data was also manually updated to those 32 songs before this workflow was agreed on. The original published snapshot remains untouched. The accepted Monday order is now saved separately, and the release builder reapplies it to its matching snapshot so later rebuilds retain it.

## Implementation

- `script/supervisedPlaylists.ts` parses CSVs, resolves the source, prepares review exports, and accepts one reviewed playlist.
- `script/supervisedOverrides.ts` validates accepted records and applies their ordered IDs to matching snapshots in memory.
- `script/buildWaxWeeklyData.ts` applies accepted overrides before creating site data and matching the First Songs mix.
- `script/supervisedPlaylists.test.ts` covers draft isolation, acceptance, restoration, validation failures, revision conflicts, and rebuilds.

Run the focused tests with:

```bash
node --import tsx --test script/buildWaxWeeklyData.test.ts script/supervisedPlaylists.test.ts
```

## Acceptance criteria

- A 32-song supervised Monday produces exactly those 32 songs in that order, with the existing export schema and metadata.
- Preparing or revising an export leaves website data and any previously accepted override unchanged.
- Explicitly accepting the reviewed export updates that one website playlist; the other 41 playlists remain unchanged.
- Unknown or duplicate IDs, invalid ranks, and mismatched source revisions fail before files change.
- Original snapshots remain unchanged, and omitted original songs can be restored in a later review.
- A full rebuild retains accepted changes without adopting unreviewed drafts or carrying overrides into a different week.
- No Spotify write, playlist generation, model training, or automatic deployment is triggered.

## Related proposals

The [future custom-day generation and learned-ordering proposal](../playlist-flow-sequencing/README.md) lives in the playlist sequencing folder. Its remaining-pool clustering, master coverage requirements, Spotify publication, and training ideas are outside this feature's current scope. The review-and-update workflow can be implemented independently.
