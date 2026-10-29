# Playlist flow sequencing proposal

Status: Proposed pilot; production clustering and nearest-neighbor sequencing are unchanged.  
Created: October 28, 2026

## Question and scope

Can Wax sequence a fixed set of songs more like Kasey by considering the preceding sequence, playlist position, artist spacing, and different sizes of Camelot movement?

The working hypothesis is that larger opening contrasts give way to longer passages of close movement, with renewed contrast toward the ending. Energy, danceability, and valence can rise and fall independently within those passages. The objective is to predict the one next song Kasey would choose from the remaining candidates, rather than minimize every difference between adjacent songs.

This feature changes ordering, not playlist membership or genre assignment. Keep current nearest neighbors available while Kasey adds songs and makes custom orders. Preserve completed custom days through the separate [custom playlist days proposal](../../docs/WAX_CUSTOM_DAYS_AND_LEARNED_ORDERING_FEATURE.md). Do not make vacation playlists depend on a trained model being ready.

The eventual target is **one model for Kasey across all six genre profiles**, not six genre-specific models. This proposal updates the earlier modeling assumptions: artist-spacing and optional title-relationship features are worth testing, while raw artist identities and song titles need not be memorized. Lyrics, audio analysis, and an LLM are not prerequisites. Personal interpretations of lyrics remain commentary unless explicitly supplied as modeling input.

## Development data

The three custom CSVs were moved here unchanged from `users/kasey/supervised/`. They represent the current chosen orders, not a history of discarded trials. The `#` column defines order. Match tracks by `Spotify Track Id`; validate unique IDs and contiguous ranks before analysis.

| Custom order | Songs | Consecutive moves | Original source-pool size |
| --- | ---: | ---: | ---: |
| [Alt Rock Monday](data/alt-rock-monday.csv) | 35 | 34 | 38 |
| [Electropop Monday](data/electropop-monday.csv) | 27 | 26 | 30 |
| [Country/Blues Monday](data/country-blues-monday.csv) | 21 | 20 | 23 |
| **Total** | **83** | **80** | **91** |

All custom IDs are present in the corresponding original export. [data-manifest.json](data-manifest.json) records original locations, byte-level SHA-256 hashes, source-pool paths relative to the repository root, and counts. The original exports remain in place. Preserve or deliberately version these snapshots before replacing source data; do not silently train against a changed pool.

For the two orders discussed while arranging songs in chat, the corresponding original daily export supplies the starting pool. Country/Blues has a matching source export, but confirm that it was the actual selectable pool before using it for supervised candidate ranking. Its current order is usable for descriptive transition analysis regardless. Do not infer a full master library as the candidate pool or assume a current snapshot is a completed session.

These are three examples from one listener, all Monday playlists. Their 80 transitions are correlated observations, not 80 independent playlists. The findings below describe this snapshot; they are not validated sequencing laws.

## Kasey's Camelot move categories

For this analysis, ignore whether the letter changes between A and B and classify only the shortest circular movement of the numeric position. Preserve A/B separately in the underlying data for later tests.

| Category | Signed Camelot steps |
| --- | --- |
| **Close moves** | 0, ±1, ±2 |
| **Mood shifter** | ±3, ±4 |
| **Jaws** | ±5, ±6 |

These are custom analytical categories. They do not replace the directional rules in [harmonic_mixing_rules.csv](../../data/harmonic_mixing_rules.csv), and a label is not a guarantee of musical compatibility or a measured mood change.

Given numeric positions `a` and `b`, let `forward = (b - a + 12) % 12`. Use `forward` for 0–5, `forward - 12` for 7–11, and the explicit tie `±6` for 6. Thus `12 → 1 = +1` and `1 → 12 = -1`. Count a six-step tie once. Categorize by magnitude: 0–2 close, 3–4 mood shifter, 5–6 jaws. A same-number A/B switch belongs to close moves but is not the same musical key. Missing or invalid keys are unknown, not close moves; exclude them from category percentages and report coverage. All 80 current moves have valid keys.

### Overall counts

| Playlist | Close | Mood shifter | Jaws | Total moves |
| --- | ---: | ---: | ---: | ---: |
| Alt Rock Monday | 21 | 5 | 8 | 34 |
| Electropop Monday | 13 | 9 | 4 | 26 |
| Country/Blues Monday | 14 | 6 | 0 | 20 |
| **Total** | **48** | **20** | **12** | **80** |
| **Percentage** | **60%** | **25%** | **15%** | **100%** |

### Beginning, middle, and end

Partition transitions, not individual songs. For `N` songs there are `M = N - 1` consecutive transitions. Number transitions with zero-based index `i`, then assign `section = floor(3 * i / M)`: 0 beginning, 1 middle, 2 end. This gives roughly equal thirds and counts every transition exactly once. Adjacent sections share a boundary song but no transition.

| Playlist | Beginning track span | Middle track span | End track span | Moves per section |
| --- | --- | --- | --- | --- |
| Alt Rock | 1–13 | 13–24 | 24–35 | 12 / 11 / 11 |
| Electropop | 1–10 | 10–19 | 19–27 | 9 / 9 / 8 |
| Country/Blues | 1–8 | 8–15 | 15–21 | 7 / 7 / 6 |

| Playlist | Section | Close | Mood shifter | Jaws | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| Alt Rock | Beginning | 3 | 2 | **7** | 12 |
| Alt Rock | Middle | **11** | 0 | 0 | 11 |
| Alt Rock | End | **7** | 3 | 1 | 11 |
| Electropop | Beginning | 3 | 3 | 3 | 9 |
| Electropop | Middle | **6** | 2 | 1 | 9 |
| Electropop | End | 4 | 4 | 0 | 8 |
| Country/Blues | Beginning | **5** | 2 | 0 | 7 |
| Country/Blues | Middle | **5** | 2 | 0 | 7 |
| Country/Blues | End | **4** | 2 | 0 | 6 |

| Section, all playlists | Close | Mood shifter | Jaws | Total |
| --- | ---: | ---: | ---: | ---: |
| Beginning | 11 (39%) | 7 (25%) | **10 (36%)** | 28 |
| Middle | **22 (81%)** | 4 (15%) | 1 (4%) | 27 |
| End | **15 (60%)** | 9 (36%) | 1 (4%) | 25 |

Percentages are rounded within each section and pooled by transition count, so longer playlists contribute more observations. Ten of twelve Jaws moves occur in the opening third. Close moves dominate the middle, while mood shifters become more frequent at the end. Country/Blues has no Jaws moves and maintains a comparatively steady category distribution. Do not require every genre or playlist to reproduce the pooled pattern or the specific numeric key 11.

These tables divide each saved selection by its current length. For live generation, use the known target length; for training on a partial selection whose eventual length was unknown, use original candidate-pool progress or another available position signal instead of leaking the future chosen stopping point. A finished-order descriptive chart is not automatically a valid training feature.

### Repeat playback

Keep closure separate from the three-section analysis; do not add it to the end section by accident.

| Playlist | Last → first | Keys | Step | Category |
| --- | --- | --- | --- | --- |
| Alt Rock | Fluctuate → All I Need Is You | 4B → 1A | −3 | Mood shifter |
| Electropop | Private Idaho → ..FEISTY | 10B → 3B | +5 | Jaws |
| Country/Blues | Lubbock or Leave It → Rollin' (The Ballad of Big & Rich) | 9B → 8B | −1 | Close |

Counting these three closures yields **49 close, 21 mood shifter, and 13 Jaws moves**, or 83 transitions. These are descriptive possible loops; only the Alt Rock closure has been explicitly discussed as intentional. A loop is not an ordinary remaining-candidate decision: the opener is already used. Score it separately when repeat playback is requested, rather than fabricate another training choice.

## Energy, danceability, and valence across the sequence

The same transition thirds give the following mean absolute energy changes, in the CSV's 0–100 feature points:

| Playlist | Beginning | Middle | End |
| --- | ---: | ---: | ---: |
| Alt Rock | 15.6 | 6.2 | 10.5 |
| Electropop | 15.6 | 11.0 | 18.0 |
| Country/Blues | 19.7 | 14.9 | 10.5 |

All three have smaller energy changes in the middle than at the beginning. Two become more variable again near the end. This supports testing a flexible opening/middle/ending pattern, not requiring uninterrupted calming or a low-energy closer.

Individual components matter as well as `Mood = Energy + Dance + Valence`. A stable sum can mask large opposing changes, while a long rise or descent depends on order and is invisible to an average alone. Alt Rock's energy descent from Get Happy to Drag Path is `87 → 86 → 78 → 75 → 72 → 63 → 58 → 49`. This is one observed passage, not a prescribed eight-song descent.

## Proposed pilot rules

Use soft preferences and tunable weights. Do not exclude songs solely because they make a large key or BPM jump. The pilot should be able to reproduce exceptions, rather than declaring human choices invalid.

| Rule family | Candidate feature or score | Guardrail |
| --- | --- | --- |
| Position and key movement | Interact beginning/middle/end or continuous progress with the three move categories; retain signed step and A/B transition separately | Test category availability among remaining songs. Do not turn the observed 39/25/36 distribution into mandatory quotas. |
| Local musical continuity | Signed and normalized absolute changes in energy, dance, valence, BPM, and optional combined Mood | Permit one feature to change while another holds. Do not double-count Mood as independent evidence or require small BPM changes. |
| Passage direction | Recent rises/falls, consecutive direction, turning points, distance from recent peaks/troughs, and candidate-inclusive trends at several window lengths | Only use the prefix and candidate, never future selected songs. Neither endless smoothness nor constant alternation is the objective. |
| Artist spacing | Artist overlap, songs since previous appearance, recent frequency, and remaining artist share | Five or six songs by one artist need room throughout the playlist. Allow intentional adjacent same-album pairs. Parse collaborators consistently. |
| Optional title wordplay | Shared distinctive words, phrases, and cautiously normalized word families | A small separate experiment; musical fit can override wordplay. Do not infer lyrical meanings or require an LLM. |
| Repeat closure | Score the last-to-first relationship for a declared loop | Do not force low-energy endings, and do not train the loop as a new candidate decision. |

The first repeated exact artist label occurs at #11 in Alt Rock, #14 in Electropop, and #12 in Country/Blues. These labels do not fully capture collaborator overlap. Alt Rock also deliberately pairs The Best Deceptions and Screaming Infidelities from the same artist and album. Those examples favor flexible spacing rather than a hard no-repeat rule.

Acousticness, instrumentalness, loudness, duration, and time signature are already present in the CSVs. Consider them only in a later, isolated experiment after checking metadata quality. Popularity is not a proxy for familiarity or a required input. Unknown values must not silently become zero.

## Pilot comparisons

Hold playlist membership and opener fixed for whole-order listening comparisons:

1. **Baseline:** existing normalized BPM–Mood nearest neighbors.
2. **Simple preferences:** baseline plus artist-spacing and Camelot-category features, without positional preferences.
3. **Sequence preferences:** add recent direction and position-by-category interactions. Compare with the simple version to isolate the value of context.
4. **Search comparison:** run greedy selection and bounded beam search using the same candidate score. A provisional beam width of 20 is a test setting, not an established optimum.

Greedy ranking directly implements choosing the best next song. Beam search retains several prefixes and can sacrifice the locally best choice for a stronger complete sequence. Its benefit must be demonstrated rather than assumed. With identical scoring and tie handling, beam width 1 should match greedy output. Normalize conditional probabilities over each prefix's actual remaining candidates before accumulating log probabilities, and handle optional loop scoring as a separate explicit term.

Initially write down a small set of weights and compare their outputs; do not extensively tune dozens of rules to these three examples. For the learned version, fit one regularized conditional ranking model across Kasey's profiles, using each human choice as the preferred candidate over the actual alternatives. Keep the model small, and fit preprocessing only on development data.

## Candidate pools, revisions, and evaluation

For each selected next song, reconstruct the preceding chosen sequence and remove those IDs from the confirmed original candidate pool. The remaining songs are the alternatives for that decision. Tracks omitted from a custom selection remain available alternatives during its recorded choices; they are not globally disliked. Do not invent an ordering for unused tracks or a stop decision.

Ordinary rearrangements replace the active order. Discarded trials are neither negative feedback nor additional training examples. Deduplicate unchanged custom orders across weekly publications. Store human orders separately from generated drafts and keep artist/title metadata usable as relationships rather than memorization keys.

The planned collection is **42 playlists: six profiles × seven days**. Pool all profiles into one model. Use five days per profile for development (30 playlists, 71.4% by playlist count), and two days per profile for held-out testing (12 playlists, 28.6%). Monday–Friday versus Saturday–Sunday is the current proposed assignment; record it before training. Tune only within the development set using whole-playlist groups. This day-based split may have a tempo-distribution shift due to weekday assignment, which should be reported rather than hidden.

These three Mondays are exploratory development examples, not an untouched test. Do not split overlapping windows or revisions between development and test. Report per-profile and pooled results; distinguish repeated-library performance from performance on unseen tracks. There is no need for Kasey to manually arrange a playlist twice.

For held-out exact-choice evaluation, use the human prefix and the actual remaining candidates at each step. Compare top-1 accuracy and mean reciprocal rank against nearest neighbors and chance (`1 / remaining_candidate_count`), broken down by position and candidate count. Exclude forced final choices. The full source pool belongs in this test even when the final human selection is shorter. For whole-order listening comparisons, use the same selected membership and opener for all algorithms; that is a different task from recovering a choice among the larger original pool.

Also compare observed category use with category availability at each decision and with fixed-opener shuffles. A preference cannot be established merely because many remaining songs share the same keys. Report macro averages by playlist alongside transition-weighted totals. Follow next-song tests with listening to generated orders, because generated prefixes can diverge from the human contexts used during evaluation.

## Implementation outline and acceptance criteria

1. Build an offline analyzer that reads these snapshots and reproduces the category counts, section boundaries, energy summaries, and separate closures. Add candidate-availability reporting when pools are confirmed.
2. Add an isolated scoring interface receiving prefix, candidate, remaining pool, position information, and settings. Preserve existing production behavior while testing.
3. Generate draft alternatives and readable feature/score explanations. Verify unique membership, fixed opener, deterministic ties, and reproducible settings.
4. Fit and evaluate one model after enough custom orders are available. Compare greedy and beam outputs with fixed scoring; model training and search are separate experiments.
5. Integrate only after held-out evaluation and listening. Custom-day preservation and collection of examples can ship first.

Acceptance requires the following:

- The three CSVs remain unchanged by analysis or draft generation. Their hashes and counts match the manifest.
- Recomputed tables sum to 80 consecutive moves: 48 close, 20 mood shifter, 12 Jaws. Section counts reconcile to each playlist's overall totals. Optional closures produce 83 total moves and remain separately labeled.
- Circular wraparound, six-step ties, A/B switches, unknown keys, and short playlists are handled explicitly. Position features do not leak a future stopping point.
- Models and rule scores are compared with nearest neighbors under matching conditions. Raw counts and appealing narratives are not presented as proof of improvement.
- No discarded revisions become dislike labels. Candidate pools and saved source features are traceable, and unknown pool provenance prevents supervised ranking rather than inventing labels.
- Model selection never uses the held-out two days per profile. One model spans all six profiles; there is no requirement to order the same playlist twice.
- Generated drafts preserve the source custom order, membership, and selected opener. No Spotify publishing, automatic migration, model training, or production algorithm change occurs simply from adding this proposal.

## Decisions remaining

Confirm source-pool provenance for external custom uploads and whether each snapshot is complete. Choose initial rule weights, available-at-generation position features, artist/collaborator parsing, and how an intentional same-album pairing can outweigh the spacing penalty. Decide whether title matching and loop scoring belong in the first pilot or separate comparisons. Use later custom orders to test these choices instead of hard-coding all patterns observed in the three Mondays.
