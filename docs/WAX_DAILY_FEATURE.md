# Wax Daily Feature

Status: Draft for future implementation  
Created: October 15, 2026

## Idea

Combine all songs from Kasey's six profiles into 30 balanced clusters, assign each cluster to a day of the month, and use a daily GitHub Actions job to select the corresponding mix. Each day offers a smaller, musically related slice of the full collection, with tracks ordered by proximity to the cluster center.

This proposal interprets “one day for each month” as one cluster for each day of the month, repeating the same rotation until the source collection is rebuilt. It assumes one combined rotation across Alt Rock, Classic Rock, Country Blues, Electropop, Indie Folk, and Pop & Hip-Hop. Creating 30 separate days per profile would be a different mode with 180 clusters.

## Listening experience

Open a single stable Spotify playlist, provisionally named `Wax - Kasey Monthly Rotation`, to hear today's cluster or, on the 31st, the 42-song Last Songs mix. Its description identifies the local date, cluster number or Last Songs label, track count, and rotation version. A future Wax Weekly card could show the same information and link to the playlist.

The local app should allow previewing all 30 clusters and the Last Songs mix before activating a version. Each day shows its songs in playback order, mean BPM, mean Mood, and contribution from each source profile. Tracks retain their profile labels even though clustering crosses genre boundaries. There is no requirement that every daily cluster contain all six profiles.

The existing seven-day profile playlists and First Songs mix remain available. This is an additional listening mode; implementing it should not change their saved state or publishing behavior.

## Building the rotation

1. Read the six configured master CSVs using the existing validation rules. Stop if an expected profile is missing or invalid.
2. Combine the tracks and deduplicate by Spotify track ID. Preserve all source profile IDs on a shared track. Conflicting BPM or Mood inputs for the same ID must be resolved before generation. Different Spotify IDs remain distinct recordings.
3. Compute `Mood = Energy + Dance + Valence`, as Wax does today. Standardize BPM and Mood over the entire combined, deduplicated library, using a safe denominator for any dimension with zero variance.
4. Always run balanced K-means with `k = 30`, regardless of month length. February still generates 30 clusters; the 31st does not add a cluster. For `N` unique tracks, cluster sizes must be either `floor(N / 30)` or `ceil(N / 30)`, and every track must appear exactly once. Require at least 30 unique tracks. For illustration, 3,000 unique tracks would yield 100 tracks per cluster.
5. Recompute each cluster center from its final members. Assign day numbers by center BPM, highest to lowest, then center Mood, then a deterministic member-ID tie-break. This extends the current BPM ranking into a simple month-long tempo progression; the ordering direction is a proposed default.
6. Sort songs within each cluster by ascending Euclidean distance to its center in standardized BPM–Mood space. Break equal-distance ties by Spotify track ID.

“Sorted by cluster center” has two distinct meanings here: centers determine the order of days, and distance from each center determines the order of songs within that day. The first song is the most representative of its cluster, followed by increasingly distant songs. Unlike the current nearest-neighbor sequence, this ordering does not optimize transitions between consecutive tracks. Preview both approaches before settling the listening experience.

Generation must be reproducible: canonicalize input order, use deterministic initialization or a recorded seed, and store the algorithm version. Rebuild only when deliberately refreshing the collection or algorithm. Freeze the active version during a month by default so day assignments do not move underneath the listener.

## Calendar mapping

Use `America/Los_Angeles` to determine the listening date. The calendar policy is fixed:

| Calendar date | Selected mix |
| --- | --- |
| Days 1–30 | Cluster matching the day number |
| Day 31 | Last Songs mix: 42 songs from the six genre profiles’ seven daily playlists |
| February 1–28 or 1–29 | Only the first 28 or 29 clusters, respectively |

All months use the same 30-cluster structure. February leaves the remaining clusters unselected; it does not merge them, redistribute their songs, or change the cluster count. Each month starts again at cluster 1.

## Last Songs mix for the 31st

Take the final song in playback order from each of the seven daily playlists for each of the six genre profiles: `6 × 7 = 42` selections. This mirrors the existing First Songs mix, using the closing song instead of the opening song. The source is the genre profiles’ weekly playlists, not the 30 monthly clusters.

Follow the configured profile order, with Monday through Sunday within each profile, matching the First Songs mix. Preserve one selection per source playlist, including repeated track IDs if a song closes more than one playlist, so the mix always has 42 entries.

Proposed source-version policy: capture the final ordered weekly playlists when preparing the monthly rotation and freeze their closing selections in its manifest. Record each selection’s profile, weekday, and source revision so the mix is reproducible. Require all 42 source playlists to be nonempty before activation. On the 31st, publish this saved mix to the same rotating destination playlist; label it Last Songs rather than cluster 31.

## Saved rotation

Generate a versioned manifest containing the source fingerprint, source profile IDs, unique track count, normalization statistics, seed or initialization strategy, algorithm version, timezone, calendar policy, and all 30 clusters with centers and ordered track IDs. Include the ordered 42-entry Last Songs mix and its source revisions, plus display metadata and profile membership for previews.

Keep a small active-version reference separate from the generated manifest. The daily job consumes that immutable version; it does not rerun clustering. Retain the previous version for rollback.

The runner needs a durable, accessible copy of the manifest, active reference, destination playlist ID, and successful publish record. Choose a tracked release directory or durable storage during implementation. Do not rely on the local `users/kasey/state/` or `snapshots/` directories: those are ignored by Git and will not automatically exist in a fresh Actions checkout. Source CSVs need not be available to the daily job if the complete manifest is published ahead of time.

## Daily GitHub Actions job

Add a future scheduled workflow with a manual dispatch option for preview, retry, and an explicit target date. A proposed daily schedule is `17 8 * * *` in UTC, which falls after midnight in Los Angeles in both standard and daylight time. Calculate the actual local date in the selector rather than treating the UTC day number as the listening day.

Scheduled workflows run from the default branch and can be delayed or dropped during high load. Keep a manual recovery path and show the last successful update rather than assuming the calendar alone proves a publish succeeded. See [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Each run should:

1. Load and validate the active manifest; resolve the target date and select its cluster or the Last Songs mix for day 31.
2. Produce a dry-run summary when requested, including the ordered track count and intended destination.
3. Replace the contents of the configured Spotify playlist with the selected ordered tracks, using the existing publisher's applicable batching and retry behavior.
4. Verify the resulting ordered track IDs before recording success. Update any site-facing “today” metadata only after successful publication.
5. Record the date, rotation version, selection type (cluster or Last Songs), cluster number when applicable, playlist ID, content fingerprint, and completion time in durable state.

Use a single concurrency group per destination playlist. Repeating the same date and version should safely converge on the same contents; an already verified successful publish can be skipped. A partial update must remain retryable and must not be recorded as complete. Reject stale scheduled work that would overwrite a newer day's playlist; deliberate historical publishing requires an explicit manual override.

Provision the destination once and retain its ID so retries do not create duplicate playlists. Store Spotify credentials in GitHub Actions secrets, never in the manifest. Activating an approved rotation grants the daily job permission to publish that version without daily interaction. The current weekly approval and state model will need a separate monthly counterpart.

## Implementation outline

- Extract reusable balanced clustering and normalization from `server/dailyPlaylists.ts`, keeping its weekly defaults intact. Allow the shared engine to accept a cluster count while fixing monthly generation at 30, and add a separate center-distance ordering mode.
- Reuse source parsing in `server/profileConfig.ts`; add combined-library validation and provenance tracking.
- Add a monthly generator, manifest validator, and date selector with CLI commands for generation, preview, and publication. These are proposed commands, not currently available features.
- Adapt applicable Spotify publishing helpers from `server/profilePublish.ts` without reusing weekly state keys or playlist IDs.
- Add the Actions workflow after durable manifest delivery and publish state are working. Add a local preview and optional Wax Weekly display separately from the existing weekly release pipeline.

## Acceptance criteria

- The union of all 30 clusters exactly equals the unique source track IDs, with no duplicates or omissions and cluster sizes differing by at most one.
- Identical input and algorithm settings produce identical assignments, day ranks, and song order.
- Tracks are ordered by nondecreasing distance to their final cluster center, including deterministic ties and zero-variance inputs.
- Generation always produces exactly 30 clusters, including in February and 31-day months. Date tests cover both daylight-saving offsets, month boundaries, and February selecting only clusters 1–28 or 1–29.
- Day 31 selects exactly 42 closing-song entries from the six profiles’ seven weekly playlists, in profile and weekday order, preserving repeated IDs. Missing or empty source playlists prevent activation; the mix never draws from the monthly cluster endings.
- Dry runs perform no Spotify writes. Retries, partial failures, and concurrent runs converge on the intended playlist without creating duplicates or recording false success.
- A fresh runner can load the active rotation and durable publish state without local-only files. The previous rotation can be restored.
- Existing weekly generation and publishing behavior pass regression checks.

## Decisions to revisit before building

Confirm the combined-library interpretation; center-distance song ordering versus the existing center-first nearest-neighbor sequence; fastest-to-slowest day ranking; and the proposed weekly source-version policy for the Last Songs mix. The 30-cluster count, February selection, and 42-song day-31 mix are settled requirements. Decide whether the first release needs only the rotating Spotify playlist or also a website display. Start with an offline 30-cluster preview to assess listening length and musical coherence before enabling automation.
