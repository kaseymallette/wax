# Angular partition proposal

Status: offline experiment; the production playlist algorithm is unchanged.

## Question and plan

Can seven contiguous angular groups in standardized BPM–valence space give each
playlist a distinct direction while retaining songs both near and far from the
collection center?

1. Validate the source CSV and retain every song's identity and source row.
2. Center BPM and valence independently and divide by their population standard
   deviations. Do not use composite Mood for this experiment.
3. Compute `theta = atan2(zValence, zBpm)` and radius with `hypot`.
4. Compare seven equal-angle sectors with seven consecutive equal-count groups
   sorted by angle. Start at positive BPM (0°), advancing counterclockwise.
5. Compare with equal-count concentric bands and Wax's existing balanced K-means
   algorithm, holding the input features at BPM and valence for all four methods.
6. Inspect counts, feature means, radial spread, and within-group sum of squared
   distances (SSE). Then listen to the groups before choosing a production change.

## Proposed rules

Equal-angle assignment is `floor(((theta - rotation) mod 2π) / (2π / k))`.
Intervals include their starting boundary and exclude their ending boundary;
0° and 360° are the same boundary. Seven sectors span about 51.43° each in
**standardized** coordinates. They need not look equal on raw BPM–valence axes.

Equal-count assignment sorts by wrapped angle, breaking exact angular ties by
Spotify track ID, then fills capacities `floor(n/k) + (sector < n % k ? 1 : 0)`.
Every source song appears exactly once; sizes differ by at most one. Boundaries
are halfway between adjacent groups' angles. If a tied angle crosses a capacity
boundary, a ray cannot separate the tied songs: membership is determined by ID,
and the report counts these split ties. This is a rank partition, not always a
strict geometric partition.

An exact centroid point has no direction: assign it angle 0 by explicit
convention and report its count. A constant feature uses scale 1 and emits a
warning; the resulting geometry is degenerate. Invalid numeric features,
duplicate or empty IDs, invalid group counts, and nonfinite rotations are errors.
Input reordering must not change ID-to-sector membership. Near-center points can
change angle sharply after small feature edits; radius is therefore part of the
report. No radius threshold excludes songs.

Rotation is a declared parameter, not an optimized result. Default is 0°; a
rotation changes the equal-count seam and can change membership substantially.
Sector numbers indicate direction, not weekdays or playback order.

## Evaluation and adoption

Balanced K-means seeks compact groups; angular partitioning preserves direction
and may allow wider radial variation. Lower SSE measures compactness, not listening
quality. Concentric bands isolate distance from the center but mix directions.
Do not infer a winner from one collection or from count balance alone.

Before integration: audition groups with the same sequencing method; compare
several collections and rotations; inspect small-input-change sensitivity and
near-center songs; decide weekday mapping and saved-opening-song migration.
A five-feature extension needs its own geometry and evaluation: `atan2` here
only defines a two-dimensional experiment.

## Reproduce

From the repository root (existing npm dependencies required):

```bash
node --import tsx --test server/angularPartition.test.ts
node --import tsx script/analyzeAngularPartition.ts
# Optional input, output directory, and rotation in degrees:
node --import tsx script/analyzeAngularPartition.ts users/kasey/profiles/pop-hip-hop.csv features/angular-partition/results 15
```

The runner writes assignments.csv, report.json, results.md and two SVG charts in
the output directory. These are reproducible snapshots, replaced on rerun. The
source CSV, app state, playlists, and Spotify are not written. K-means is reused
through the existing builder with energy and dance set to zero in an in-memory
copy, making its Mood coordinate exactly valence. Its group numbering retains
the builder's weekday ordering solely as labels; labels are not comparable
between methods.

See [measured results](results/results.md), [assignment export](results/assignments.csv),
and [machine-readable report](results/report.json).

![Partition comparison](results/partitions.svg)

![Counts and radial spread](results/distributions.svg)
