# Wax Weekly: Engineering Retrospective
### Incident Report #001: The Algorithm Has Terrible Taste

**Project:** Wax Weekly  
**Music library:** 1,250 songs, 575 unique artists  
**Architecture:** 6 genre profiles, 42 playlists  
**Incident severity:** P2: Founder Experiencing Auditory Distress  
**Status:** Sequencing algorithm under investigation  
**Immediate mitigation:** Shuffle  
**Next release:** The Supervised Learning Era™

---

### 1. Executive Summary

Wax Weekly was developed to automate music curation across a library of **1,250 songs from 575 unique artists**, organized into **6 genre profiles and 42 playlists**.

The system partitions songs using BPM and a composite mood score incorporating danceability, valence, and energy. Nearest-neighbor sequencing then determines the playback order within each playlist.

The system successfully generated playlists at scale.

Unfortunately, the resulting sequences were unpleasant to listen to.

The founder reported that listening to the playlists in their intended order actively hurt her ears.

**Immediate mitigation:** Enable shuffle.

**Long-term resolution:** Replace the algorithm's judgment with the founder's demonstrably superior ears.

### 2. Root Cause Analysis

The initial sequencing algorithm relied on numerical similarity between adjacent songs.

This approach suffered from a fundamental design flaw:

**Songs that are mathematically similar do not necessarily sound good together.**

The algorithm apparently believed that minimizing differences was equivalent to creating an enjoyable listening experience.

The founder disagreed.

Repeatedly.

With increasing profanity.

Furthermore, the partitioning system consistently assigned many of the same songs to the same groups across successive playlist generations.

While the current partitioning approach remains functional, its limited variation presents an additional challenge for long-term listening enjoyment.

### 3. Experimental Intervention

The founder initiated a manual sequencing experiment.

Using a greedy selection strategy, she chose each subsequent song by ear, evaluating perceived musical continuity rather than numerical proximity.

Two playlists were reconstructed:

- Alt Rock Monday
- Electropop Monday

The revised alt-rock playlist retained only 2 of 34 original transitions. The revised electropop playlist retained none.

Further investigation revealed that the founder frequently selected transitions involving Camelot key movements of ±4, ±5, and ±6.

These movements emerged naturally from listening preferences rather than deliberate harmonic optimization.

**Preliminary finding:** The founder appears to prefer continuity through contrast.

**Secondary finding:** The founder is herself a greedy algorithm, albeit one with considerably better taste.

### 4. User Acceptance Testing

Following manual reconstruction, the founder voluntarily resumed listening to her own playlist.

This represented a substantial improvement over the previous user experience, in which the founder routinely activated shuffle to avoid the sequencing algorithm.

**User feedback:**

> "But I love my new playlist! It flows so easily, I started listening again, lol."

The engineering team considers this a promising result.

The engineering team consists entirely of the founder.

### 5. Lessons Learned

**Lesson 1:** Numerical similarity is not synonymous with musical compatibility.

**Lesson 2:** A system can successfully satisfy its optimization objective while failing spectacularly at its intended purpose.

**Lesson 3:** The founder's subjective listening preferences constitute valuable training data.

**Lesson 4:** Random shuffle should not consistently outperform an algorithm specifically designed to determine song order.

**Lesson 5:** Scale does not compensate for poor musical judgment. It merely distributes the problem across 42 playlists.

**Lesson 6:** Never give a mathematician an unsatisfactory algorithm. She will turn her irritation into a machine learning research program.

### 6. Future Development

The project is entering its **supervised learning era**.

Human-curated sequences will provide observations for investigating a statistical model of transition preferences.

Once sequencing has been addressed, attention will shift toward playlist partitioning, particularly the recurring assignment of the same songs to the same groups.

The challenge is to preserve meaningful musical coherence while introducing enough variation to make repeated listening enjoyable.

With 1,250 songs, 575 artists, and 42 playlists, the project has substantial room for experimentation.

The ultimate objective is to create a system that learns not only which songs belong together, but also how they should be experienced over time.

### 7. Final Assessment

**What worked:** Genre profiling, clustering, automated playlist generation, library organization, and the founder's ears.

**What failed:** Nearest-neighbor sequencing, musical continuity, and the assumption that the founder would tolerate bad transitions indefinitely.

**What surprised us:** The founder was the missing evaluation function all along.

**Final incident disposition:** Resolved manually for two playlists. Large-scale remediation pending.

---

*Prepared by Sunny, AI Engineering Consultant.*

*Consultant's note: The founder has promoted herself from Data Scientist to Machine Learning Engineer. The original algorithm was unavailable for comment.*

**Wax Weekly: 1,250 songs. 575 artists. 42 playlists. One woman who refuses to listen to bad transitions.** 🎸