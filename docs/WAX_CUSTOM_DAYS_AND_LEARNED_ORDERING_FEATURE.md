# Wax Custom Playlist Days and Learned Ordering Feature

Status: Draft for future implementation  
Created: October 27, 2026

## Idea

Allow a profile to have a master playlist plus optional custom playlists assigned to weekdays. Preserve each custom day's exact membership and playback order, remove its songs from the automatic pool, and cluster the remaining songs into the remaining days.

Use personally arranged playlists as demonstrations for a statistical next-song ranking model. Given an opening song, the preceding sequence, and the remaining candidates, the model should predict the one song the listener would choose next. Offer direct next-song selection and experimental beam search as separate ways to generate a new order from that model.

These features solve related but distinct problems: custom days preserve work already done; learned ordering proposes new sequences that reflect the listener's choices. Custom days must work without a trained model. No lyrics, audio files, audio analysis service, or LLM is required for the proposed first version.

## Listening experience

During collection setup or refresh, upload or select the master CSV and optionally attach a custom CSV to Monday, Tuesday, or any other day. Show these assignments before generating the week. A custom day displays its uploaded order and a Custom label; the remaining days display their generated playlists.

For master plus custom Monday, Wax keeps Monday intact and generates Tuesday through Sunday around it. New master songs enter the automatic pool. Uploading a refreshed master must not clear Monday, insert songs into it, reorder it, or move it to another day.

The motivating example is Kasey's 27-song Electropop Monday, beginning with `..FEISTY` and ending with `Private Idaho`. Uploading that custom Monday should preserve all 27 selections in order. The other three songs from the original 30-song Monday return to the automatic pool along with the rest of the unreserved master. They are not globally disliked or excluded songs.

Editing or replacing a custom CSV replaces its active order. Removing a custom-day assignment releases its songs and weekday back to automatic generation. Preview the resulting week before using the existing review and publish workflow. A custom day's first-song dropdown must not silently reorder it; generating an alternative requires an explicit new draft.

For learned ordering, choose an automatic playlist or a copy of a custom playlist, select its opener, and generate a new draft. Show the ordering method and let the listener compare the result with the original. The original custom order remains intact unless explicitly replaced.

## Current implementation

- [server/dailyPlaylists.ts](../server/dailyPlaylists.ts) creates seven balanced clusters from standardized BPM and `Mood = Energy + Dance + Valence`. It assigns weekdays using BPM ranks `[1, 3, 6, 4, 2, 5, 7]`.
- Its `orderClusterMembers` function begins at a chosen opener or the member nearest the center, then repeatedly selects the nearest remaining song in BPM–Mood space. It considers only the previous song. Individual feature trajectories and Camelot relationships do not affect ordering.
- The candidate track already contains BPM, energy, dance, valence, and Camelot data. No new audio data source is necessary to experiment with sequence scoring.
- [server/profileWorkflow.ts](../server/profileWorkflow.ts) persists opening-song choices and review state, not full custom orders. It loads those preferences only when the master fingerprint matches. Custom-day definitions need separate persistence that survives master updates.
- [server/profileConfig.ts](../server/profileConfig.ts) reads already configured profile masters. The proposed reservation happens within a profile before its daily clustering, not before a global genre classifier. Cross-profile reservations are outside the initial scope.
- [server/routes.ts](../server/routes.ts) validates opening-song changes against a fresh automatic build. That validation must use the actual custom/generated day membership after this feature is introduced.

This document proposes behavior only. It does not implement the feature, save the conversational playlist, train a model, or change a published playlist. It is separate from the monthly rotation proposed in [Wax Daily Feature](WAX_DAILY_FEATURE.md).

## Custom playlist inputs and validation

The master remains authoritative for track metadata and current numerical features. A custom CSV supplies track identities and order. Accept the existing exported `track_id` format and the master format's `Spotify Track Id`; match exact Spotify IDs rather than song titles. Different recording IDs remain distinct.

Proposed ordering convention: when a `rank` column exists, require unique contiguous positive ranks starting at 1 and sort by rank. Otherwise preserve physical CSV row order. Show the resolved order before saving. Stale feature columns in a custom export must not override master values.

Validate all assignments together before generation:

- At most one custom playlist per weekday within a profile; each assigned playlist is nonempty.
- No duplicate track ID inside a custom playlist or across custom days in the same profile.
- Every reserved track exists in the current master. Missing IDs block generation with the affected day and tracks listed; never silently drop them. Let the user correct the master or custom selection.
- The existing master validation remains applicable. Do not apply its 70-track minimum to a custom day or to the remaining automatic pool.
- A custom playlist can have any positive size supported by the master; it need not match automatic cluster sizes.

Reservations are scoped to the profile. A song present in two genre profiles may still appear in each profile's week under current collection semantics.

## Building the remaining week

Let `C` be the number of custom days, `K = 7 - C`, and `R` the set of master tracks not reserved by custom days.

1. Validate the master and custom assignments, then materialize each custom day in its exact saved order.
2. Remove all reserved track IDs from the automatic pool.
3. If `K > 0`, require at least `K` remaining songs so every automatic day can be nonempty. Cluster `R` into exactly `K` balanced clusters. Their sizes differ by at most one.
4. Proposed normalization: compute BPM and Mood standardization over `R`, with the existing safe handling of zero variance. Record the statistics. With no custom days, this reduces to current behavior.
5. Assign generated clusters only to unreserved weekdays using the proposed mapping below, then apply the selected ordering method to those clusters.
6. Assemble all seven days and verify that each master track appears exactly once across the week.

For `K = 0`, skip clustering. Proposed initial policy: require the seven custom days to cover the master exactly. If unassigned songs remain, show them and require resolution rather than silently omitting them. Supporting an explicit overflow library would be a separate product decision.

### Assigning fewer clusters to weekdays

Preserve the current relative weekday tempo priorities. Sort the available weekdays by their original priority in `[1, 3, 6, 4, 2, 5, 7]`, then assign the generated clusters from highest to lowest mean BPM. Break ties deterministically using the existing stable cluster identity.

With Monday reserved, the automatic clusters from fastest to slowest go to **Friday, Tuesday, Thursday, Saturday, Wednesday, Sunday**. Custom Monday stays Monday regardless of its average BPM. Compute any displayed actual BPM ranking separately from this assignment policy.

Identical master, custom definitions, and algorithm settings must produce identical results. Newly uploaded master songs may change automatic memberships; only custom days are protected from reclustering.

## Saved custom days and continuity

Store custom-day definitions independently of generated weekly state and master fingerprints. Each definition includes profile ID, weekday, ordered track IDs, source filename or upload provenance, content revision, and schema version. Reload it on every generation and validate it against the latest master.

A generated-week manifest records the master fingerprint, custom-day revisions, day origins, ordered track IDs, normalization settings, clustering version, and ordering settings. Master or custom changes invalidate affected generated results and stale review/export/publication state without deleting the custom definitions.

Keep saved human order separate from generated alternatives. Revisions replace active choices; discarded experiments must not become negative feedback or additional demonstrations. Internal recovery history, if retained, is excluded from training by default. Repeated weekly use of an unchanged custom order must not duplicate its training weight.

CSV exports, Spotify publishing, weekly snapshots, and First Songs selections must consume the final assembled orders. Custom days must never pass through nearest-neighbor ordering on these paths.

## Training examples: one best next song

The listener's task is: select a starting song, then choose the one best next song from the remaining choices, repeating until the intended ending. A training example contains:

| Field | Meaning |
| --- | --- |
| Listener and demonstration ID | Whose preference is represented and which active custom order supplied it |
| Source snapshot | Candidate track IDs and numerical features available during arrangement |
| Initial candidate pool | The actual selectable tracks before ordering began |
| Chosen prefix | Every song already selected, in order |
| Remaining candidates | Initial pool minus the chosen prefix |
| Chosen next track | The single preferred continuation in that context |
| Completion state | Full ordering or an intentionally ended partial selection |
| Provenance | Human arrangement, model-generated draft, and explicit later listening feedback kept distinct |

For the original 30-song Monday, after `..FEISTY` there are 29 candidates and `Shut Me Up` is the chosen answer. It should rank above the other 28 in that context. Alternatives are less suitable at that position, not globally bad tracks. After `Shut Me Up`, use the entire chosen prefix and the reduced candidate pool to learn the selection of `All A Mystery`.

A complete 30-song ordering supplies 28 decisions with alternatives after the user-selected opener. The last remaining song is forced and contributes no ranking comparison. A 27-song selection from a known 30-song pool supplies 26 next-song decisions after the opener, with unused tracks still present as alternatives. Do not invent a next song or learn a stopping rule from the chosen ending in the first version.

**An uploaded custom order alone does not establish the original candidate pool.** Do not assume the entire master was available when the listener arranged one daily playlist. Capture a reference to the source daily-playlist snapshot when possible. For external uploads, allow attaching the source pool. If it is unknown, retain the custom day but exclude it from supervised ranking until resolved; do not fabricate alternatives.

At the end of an ordering session, derive examples from the current final order only. Feature snapshots preserve what was known when the choices were made even if a later master updates the metadata. Saved arrangements are demonstrations; they are not proof that a subsequent listening session succeeded. Generated drafts must not automatically become human training data merely because they were exported or published.

## Sequence features

Keep BPM and combined Mood for playlist membership. For ranking within a playlist, use individual features and the ordered context. Candidate inputs can include:

- Candidate BPM, energy, dance, valence, and Mood; signed changes from the previous song; and scale-normalized magnitudes.
- Feature values and changes at several recent positions, with explicit missing-context indicators near the opener.
- Trends over several candidate-inclusive window lengths, consecutive rises or falls, turning points, and rebound size relative to recent peaks and troughs.
- Camelot number step, A/B transition, same-key indicator, and optional named harmonic relationship. These are preferences to learn, not hard compatibility filters.
- Recent key-step sequences, including periods of small movement after larger jumps.
- Candidate rank within the remaining pool, number of remaining choices, and relative playlist position. The candidate pool shrinks, so late decisions have different constraints.

For numeric Camelot movement, use the shortest signed circular distance on 12 positions: `12 → 1 = +1`, `1 → 12 = -1`. Encode a six-position tie explicitly rather than inventing a direction. Preserve A/B as a separate categorical feature; do not subtract Camelot labels as ordinary linear numbers. Missing keys need an explicit missing indicator, not a fabricated key or automatic exclusion.

Rolling averages may be supplementary features but cannot represent an arc by themselves: changing song order leaves a window's average unchanged. The observed energy sequence `48 → 70 → 52 → 84 → 72` and valence sequence `42 → 43 → 49 → 66 → 30` are an example to describe, not a universal rule to enforce. Existing metadata cannot explain every perceived vocal, instrumental, or lyrical connection.

## Statistical scoring model

Start with a small regularized conditional ranking model trained per listener. One concrete baseline is a linear score over the context/candidate features, including a limited set of sequence interactions. Apply a softmax over the actual remaining candidates and train to maximize the probability of the chosen next song. Group the loss by decision so large early candidate pools do not accidentally count as dozens of independent user decisions.

This model learns parameters for repeatable sequence features without requiring an LLM. If the simple model underfits after collecting sufficient data, compare a small nonlinear ranker using the same decision groups. Select the implementation library during development; no new dependency is prescribed here.

Do not use track IDs, titles, or artist identities as predictive inputs in the first experiment. Retain IDs for bookkeeping and evaluation. This encourages transferable feature patterns, although repeated songs can still be recognizable from their feature combinations. Fit normalization and any feature selection on training data only. Mood is derived from three components, so control redundancy through regularization and feature ablations.

Save model version, training demonstration revisions, feature schema, normalization statistics, hyperparameters, seed, and evaluation results. Training updates create a candidate model rather than silently replacing the active model. Without a usable model, keep nearest-neighbor ordering available and clearly identify the fallback.

## Generating orders and beam search

Preserve daily membership and the selected opener. Generate only from the songs still available in that day, each exactly once.

| Method | Selection behavior |
| --- | --- |
| Existing nearest neighbor | Choose the closest remaining song in standardized BPM–Mood space |
| Learned greedy ranking | Choose the model's highest-scoring next song, update the prefix, and repeat |
| Learned beam search | Keep several promising prefixes and compare their possible continuations |

Learned greedy ranking directly matches the listener's stated next-best-song process and is the primary learned baseline. Beam search is an optional experiment: it can sacrifice the locally highest-ranked next song for a stronger total sequence. It is not automatically more faithful to the user's choices.

For beam search, start with the requested opener. At each depth, score remaining candidates separately for each prefix, extend the retained prefixes, and retain the best `B` by cumulative conditional log probability. A provisional beam width of 20 is a tuning starting point, not a quality claim. Normalize probabilities over the full actual candidate pool before optional expansion pruning. Compare equal-depth prefixes and use deterministic track-ID tie breaks.

All complete candidates have the same membership and length; the final forced choice has probability 1 and adds zero log probability. Width 1 should reproduce learned greedy ranking under identical tie handling. Record width, pruning settings, model version, and generation settings so an order can be reproduced. Beam search is approximate and does not guarantee a global optimum.

Benchmark runtime on the supported profile sizes and skewed custom-day sizes. Set a bounded search budget and show any fallback rather than silently switching methods. A new opener is a legitimate input, but generated contexts may differ from human training examples; exact next-song test accuracy alone cannot establish the quality of a whole generated order.

## Evaluation and collecting examples

One custom order per distinct playlist is sufficient. The listener does not need to manually reorder the same playlist twice. Collect current arrangements naturally, and keep informal drafts out of the dataset.

As a planning estimate, 5–7 playlists can exercise the pipeline, and 10–20 playlists of around 30 songs can support an initial experiment. These are not established sample-size guarantees. Decisions from one order are correlated; report playlist counts as well as decision counts.

Reserve complete playlists for evaluation before tuning. Keep revisions and identical demonstrations in the same split, and do not randomly split overlapping windows of one order across training and test sets. With few playlists, report grouped validation and its variability rather than claiming a reliable generalization score. Keep a final set of playlists untouched by tuning when enough examples exist.

For each held-out decision, use the actual human prefix and actual remaining candidates, then report top-1 accuracy and mean reciprocal rank. Top-1 measures the user's single-right-answer task; top-k can be supplemental, not a substitute. Break down results by remaining candidate count and compare with both nearest neighbor and the chance baseline `1 / candidate_count`. Exclude forced final selections. Test repeated-library generalization separately from stricter tests involving unseen songs.

Evaluate full generated orders through listening as a separate step. A new opener has no known exact human reference unless the user supplies one, so do not claim exact-order accuracy there. The user can listen and give optional feedback without rebuilding the playlist. Revisions alone are not dislike labels. Compare learned greedy and beam search with the same membership and opener before choosing a default.

## Implementation outline

1. Add custom-day definitions, a dedicated custom CSV parser, validation, and persistence outside master-fingerprint resets. Expose weekday assignment and resolved-order preview in collection setup and playlist views.
2. Parameterize balanced clustering by the number of unreserved days, implement remaining-day assignment, and merge generated and custom days. Preserve existing seven-day behavior when no reservations exist.
3. Update result types, ordering-mode metadata, routes, opener validation, revision hashes, review state, exports, publication, weekly snapshots, and First Songs consumers to respect day origin and exact order.
4. Add explicit demonstration capture with source candidate pools and feature snapshots. Keep active human demonstrations separate from generated orders and ignored drafts.
5. Build offline feature extraction, training, grouped evaluation, and a versioned scoring interface. Start with learned greedy ranking before adding beam search over the same scores.
6. Add experimental generation controls and draft comparison. Promote a model or ordering default only after evaluation and listening, without overwriting custom days.

Proposed stages can ship independently: custom-day preservation first, demonstration capture second, learned ranking third, and beam-search comparison fourth. Training should not delay preserving Monday.

## Acceptance criteria

- Master plus a 27-song custom Monday yields that exact ordered Monday and six generated days. No song appears twice or disappears; the weekly union equals the master.
- From zero through seven custom days, assignment respects reservations, automatic cluster sizes differ by at most one, and empty-pool/insufficient-pool/full-reservation cases follow the explicit validation policy.
- Zero custom days reproduces current clustering, weekday assignment, and nearest-neighbor output. Tests cover identical features and deterministic ties.
- Refreshing the master preserves custom definitions. Missing reserved tracks and cross-day duplicates produce actionable errors without mutating saved custom orders.
- Replacing an order updates its active demonstration; discarded trials and repeated publication do not become extra training examples. Unknown source pools never produce fabricated ranking labels.
- Training examples reconstruct exact prefixes and candidate sets, distinguish partial selections, and exclude forced choices. Features contain no future song information.
- Evaluation separates whole playlists and revisions, fits preprocessing only on training data, and reports exact-choice accuracy with baseline and candidate-count context.
- Generated orders preserve the opener and membership, use each track once, and record reproducible settings. Beam width 1 matches learned greedy output; larger beams are tested for runtime and sequence quality.
- Custom days remain unchanged through preview, export, Spotify publication, weekly snapshot creation, and First Songs extraction. Existing revision/review protections remain effective.
- No model training, automatic promotion, publication, or new scheduled job is triggered merely by this proposal.

## Decisions to revisit before building

Confirm the proposed remaining-weekday tempo mapping and the seven-custom-day leftover policy. Decide how the current local configuration workflow should expose master/custom uploads, and where external users attach the original candidate pool for a demonstration. Decide whether one listener's genre profiles share one model with profile context or initially train separate models; avoid pooling different listeners by default.

Select a lightweight ranking implementation and validation protocol after the first batch of custom orders exists. Tune context lengths, feature interactions, beam width, and pruning from held-out evidence rather than treating this one Monday's patterns as settled rules. Decide how explicit listening feedback should be collected independently of ordinary edits. Preserve custom days regardless of those modeling decisions.
