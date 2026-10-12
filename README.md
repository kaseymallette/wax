# Wax

Wax is a local-first playlist app that turns personally curated genre collections into a deliberate weekly rotation. It uses **balanced K-means clustering on BPM and Mood**, **nearest-neighbor sequencing**, and the **Spotify Web API** to build and publish seven daily playlists per collection.

[Wax Weekly](https://waxweekly.com/) turns the Wax workflow into a weekly listening experience across six genre-bending profiles: **Alt Rock, Classic Rock, Country Blues, Indie Folk, Pop & Hip-Hop, and Electropop**. Every song is curated by me, then distributed and sequenced using Wax.

## Introduction

Wax started with a simple frustration: **I wanted to listen to playlists on shuffle and hear every song.**

There is a real problem with random playback, and it's not just me who thinks they've heard the same song for the fourth time. In 2025, Spotify introduced **Fewer Repeats** after listeners reported that Shuffle felt repetitive, with certain songs and artists surfacing again and again. Spotify’s engineers attributed that experience to statistical randomness itself: a random sequence does not guarantee an even distribution, even when every track has an equal chance of appearing. [Spotify Engineering, “Shuffle: Making Random Feel More Human”](https://engineering.atspotify.com/2025/11/shuffle-making-random-feel-more-human). 

Given that I often shuffled my entire Liked Songs library, which contained thousands of songs, making it through a complete random sequence was nearly impossible. I would search for a song, switch playlists, change genres, or navigate somewhere else, replacing the queue before the sequence ever finished. The next time I hit Shuffle, songs I had already heard had another chance of landing near the front of the queue.

So I started making smaller playlists. Even then, I noticed that not every song appeared in the playback queue when I hit Shuffle. **Fewer Repeats** generates several random versions of a playlist, then uses listening history to choose which sequence to play. I wanted something simpler: **a guarantee that every song I selected would make it into the rotation.** With access to more music than anyone can realistically listen to, discovery is only half the problem. The real challenge is keeping great songs from disappearing back into an endless library.

Instead of generating another random order, I wanted to know that the songs in my active listening library were being **deliberately distributed across the week.** I wanted repetition, because I like hearing songs again. I wanted novelty, because I did not want to hear the same subset constantly. And I wanted the individual playlists to have enough musical continuity that they still felt good to listen to from beginning to end.

**So I built my own system.**

## The app

Wax brings my genre collections together in one local app: **Collections → Organize → Save & publish**.

### 01: Collections

Your music starts here. Browse your genre collections and choose one to turn into a week of listening:

![Wax Collections welcome page showing the three-step workflow and Kasey's collection](images/wax_local_collections_01.png)

My six collections, each with its own record-sleeve artwork:

![Kasey's six genre collections: Alt Rock, Classic Rock, Country Blues, Electropop, Indie Folk, and Pop & Hip-Hop](images/wax_local_collections_02.png)

### 02: Organize

Choose a collection and explore its seven daily playlists, with song counts and average BPM for each day:

![Wax Organize page showing genre collections and Monday through Sunday playlists](images/wax_local_organize_01.png)

Choose an opening song and preview the tracks in each day's playlist:

![Monday's playlist with an opening-song selector, track previews, BPM, and Spotify links](images/wax_local_organize_02.png)

Looking for a song or artist? Search the collection to see which day each song is on:

![Search results for Nirvana showing each song's assigned day and position in the playlist](images/wax_local_organize_03.png)

### 03: Save & publish

Take your week with you. Save a collection's seven daily playlists as CSVs, approve the week, and send them to Spotify:

![Alt Rock's Save & publish page with saved daily CSV downloads, week approval, and the Publish collection button](images/wax_local_save_and_publish_01.png)

Once all seven playlists are on Spotify, Wax saves a weekly snapshot and gives you links to each day's playlist:

![Alt Rock's completed publish with confirmation that all seven playlists are on Spotify, a saved weekly snapshot, and daily Spotify links](images/wax_local_save_and_publish_02.png)

#### First-song playlist

First songs. One mix. Bring together the opening song from every day across all profiles.

![First-song mix preview showing the Monday–Sunday opening songs for Alt Rock and Classic Rock](images/wax_local_first_song_playlist_01.png)

The mix includes six genre profiles: Alt Rock, Classic Rock, Country Blues, Electropop, Indie Folk, and Pop & Hip-Hop. Save it as a CSV or publish it as its own Spotify playlist:

![The remaining first-song mix selections, grouped by Country Blues, Electropop, Indie Folk, and Pop & Hip-Hop](images/wax_local_first_song_playlist_02.png)

## Methods

### 1. Create a user folder

Each user has a folder containing one config file and a `profiles` folder for their source playlist CSVs. Using my username, `kasey`:

```bash
mkdir -p users/kasey/profiles
```

My six genre collections are organized like this:

```text
users/
└── kasey/
    ├── config.json
    └── profiles/
        ├── alt-rock.csv
        ├── classic-rock.csv
        ├── country-blues.csv
        ├── electropop.csv
        ├── indie-folk.csv
        └── pop-hip-hop.csv
```

I maintain the music in each collection outside Wax. Each CSV is the complete source for one genre; every song in a valid source gets a place in the week's playlists.

### 2. Create the user config

Create `users/kasey/config.json` with the username, profile names, and paths to the CSVs:

```json
{
  "username": "kasey",
  "profiles": [
    {
      "id": "kasey-alt-rock",
      "name": "Alt Rock",
      "masterCsvPath": "profiles/alt-rock.csv",
      "stationId": "kasey-alt-rock",
      "enabled": true
    },
    {
      "id": "kasey-classic-rock",
      "name": "Classic Rock",
      "masterCsvPath": "profiles/classic-rock.csv",
      "stationId": "kasey-classic-rock",
      "enabled": true
    },
    {
      "id": "kasey-country-blues",
      "name": "Country Blues",
      "masterCsvPath": "profiles/country-blues.csv",
      "stationId": "kasey-country-blues",
      "enabled": true
    },
    {
      "id": "kasey-electropop",
      "name": "Electropop",
      "masterCsvPath": "profiles/electropop.csv",
      "stationId": "kasey-electropop",
      "enabled": true
    },
    {
      "id": "kasey-indie-folk",
      "name": "Indie Folk",
      "masterCsvPath": "profiles/indie-folk.csv",
      "stationId": "kasey-indie-folk",
      "enabled": true
    },
    {
      "id": "kasey-pop-hip-hop",
      "name": "Pop & Hip-Hop",
      "masterCsvPath": "profiles/pop-hip-hop.csv",
      "stationId": "kasey-pop-hip-hop",
      "enabled": true
    }
  ]
}
```

- `username` matches the user folder and the `WAX_USER` used to launch the app.
- `id` is a unique, stable profile identifier. It is also used in Spotify playlist names.
- `name` is the display name shown in the app.
- `masterCsvPath` is relative to the config file, so `profiles/alt-rock.csv` resolves inside `users/kasey/`. Absolute paths also work.
- `stationId` is optional metadata for the weekly site; the current publisher uses `id`.
- `enabled` controls whether the profile participates in the workflow.

A user can have one profile or several. Keep usernames and IDs lowercase, using hyphens between words.

### 3. Prepare the source CSVs

Place one master CSV per profile in `users/kasey/profiles/`. The current parser expects these column names:

| Column | Requirement |
| --- | --- |
| `Song` | Song title |
| `Artist` | Artist name |
| `Spotify Track Id` | Unique 22-character Spotify track ID |
| `BPM` | Positive number |
| `Energy` | Number from 0–100 |
| `Dance` | Danceability, from 0–100 |
| `Valence` | Number from 0–100 |

Optional columns include `Album`, `Album Date`, and `Camelot`.

Each enabled profile must contain **70–700 songs**. Wax checks every enabled CSV before opening the workflow. If a file is missing, has invalid data, or falls outside that range, the Collections page explains what needs fixing. Update the source file, then click **Refresh collection**.

### 4. Run Wax

From a fresh checkout, install dependencies first:

```bash
git clone https://github.com/kaseymallette/wax.git
cd wax
npm install
```

After creating your user folder, config, and source CSVs, start the app from the repository root:

```bash
WAX_USER=kasey npm run dev
```

Open [Wax locally](http://127.0.0.1:3000).

To switch users, stop the server with **Ctrl+C** and start it with the other username:

```bash
WAX_USER=kaseysdad npm run dev
WAX_USER=kaseysmom npm run dev
```

Switch genres within the app; there is no need to restart between profiles. Always specify `WAX_USER` to select the intended user. Run only one app instance per user while editing or publishing.

### 5. Organize the week

On **Collections**, check that the source playlists are ready, then choose **Organize playlists**. On **Organize**, select a genre and a day to inspect its songs.

Wax groups songs using two dimensions:

- **BPM**, the song's tempo.
- **Mood = Energy + Danceability + Valence**, ranging from 0–300.

The dimensions are standardized before clustering so their scales do not dominate the distance calculation. Balanced K-means assigns every song to one of seven groups, enforcing the target sizes during clustering. Playlist sizes differ by at most one song. For example, 193 songs become four playlists of 28 and three playlists of 27.

Wax ranks the clusters by their **average BPM**, highest to lowest, and assigns them to days:

| Day | BPM rank |
| --- | --- |
| Monday | 1 — fastest |
| Tuesday | 3 |
| Wednesday | 6 |
| Thursday | 4 |
| Friday | 2 |
| Saturday | 5 |
| Sunday | 7 — slowest |

This gives Monday a faster start, Wednesday a breather, Friday a lift, and Sunday the slowest mix. Each day card displays its average BPM. Mood influences the clusters; average BPM determines their days.

Within each daily playlist, Wax starts with the song nearest the cluster's center, then repeatedly chooses the nearest remaining song in BPM–Mood space. Choose a different opening song from the dropdown to immediately recalculate the sequence. **Opening-song choices save automatically.**

Use the preview button to open a Spotify embed or the Spotify link to listen there. Search by song title or artist across the selected genre's entire week; each result shows its day and position. Select a result to jump to that song.

Generation is deterministic for an unchanged source. Editing a source CSV resets its saved opening choices and approvals when the app next loads it.

### 6. Save and publish

Choose **Continue to save & publish** when the collection is ready. The page displays the target week: **next week, beginning next Monday**, based on the computer running Wax. For example, preparing playlists on October 11, 2026 targets October 12–18.

**Save playlist CSVs** writes all seven playlists in their current order and offers individual downloads. Spotify access and approval are not required to save CSVs. The app shows **Your playlists are saved** when the current version has been exported for that week.

To publish the selected collection:

1. Click **Approve this week** to approve all seven playlists together.
2. Click **Check Spotify account** and verify the destination account.
3. Click **Publish collection**.

Publishing saves the CSVs, creates or updates seven private Spotify playlists, and then saves a weekly snapshot. For my Alt Rock profile, the names are:

```text
Wax - Kasey-alt-rock Monday
Wax - Kasey-alt-rock Tuesday
Wax - Kasey-alt-rock Wednesday
Wax - Kasey-alt-rock Thursday
Wax - Kasey-alt-rock Friday
Wax - Kasey-alt-rock Saturday
Wax - Kasey-alt-rock Sunday
```

Repeat for each genre. Publishing again updates the existing Wax playlists for that profile and day. Changing songs or their order requires approving the week again.

If publishing fails partway through, use **Retry publish**. Progress is saved after each successful Spotify playlist update. If only the weekly snapshot failed, retrying saves the snapshot without repeating completed Spotify writes.

#### First-song mix

On **Save & publish**, **First songs. One mix.** brings together the opening song from every day across all enabled profiles. It follows the profile order in your config, with Monday–Sunday together for each profile. Kasey's six profiles make a 42-song mix: Alt Rock first, then Classic Rock, Country Blues, Electropop, Indie Folk, and Pop & Hip-Hop.

Expand the mix to check the songs, then choose **Save mix CSV** or check your Spotify account and choose **Publish first-song mix**. The Spotify playlist is named `Wax - Kasey First Songs`. Updated choices replace the songs in the same Spotify mix. CSV exports keep each version separately. The mix uses your current opening-song choices, including any you let Wax choose; after changing an opener, return to Save & publish or select **Refresh mix**. Your daily playlists keep their existing order.

## Spotify setup

CSV generation works without Spotify credentials. Publishing uses the Spotify account authorized in the local `.env` file; changing `WAX_USER` does not change that Spotify account.

Create `.env` from `.env.example` if you do not already have one. Fill in the credentials for your Spotify developer app:

```dotenv
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
SPOTIFY_REFRESH_TOKEN=
WAX_USER=kasey
```

Configure the same redirect URI in your Spotify app settings, then run:

```bash
npm run spotify:auth
```

Authorize the account you want to publish to. Copy the refresh-token line printed by the helper into `.env`, then restart Wax. The helper requests playlist read and modification permissions. Keep `.env` local; it is excluded from Git.

## Saved files

Wax creates these folders as you use the app:

```text
users/kasey/
├── config.json
├── profiles/     # Master CSVs you maintain
├── state/        # Opening choices, approvals, and publish progress
├── exports/      # Seven CSVs and a manifest per exported version
└── snapshots/    # Weekly JSON snapshots after successful publishing
```

Export folders use the genre, target Monday, and a short version fingerprint—for example, `alt-rock-2026-10-12-<fingerprint>`. CSV names are shorter, such as `alt-rock-monday.csv`. Saving a changed version creates another export folder; previous versions are retained.

Configs, source CSVs, and exports can be tracked in Git. Local state, snapshots, credentials, and backups are ignored. Back up `state/` and `snapshots/` separately if you want to preserve opening choices, publish progress, and weekly history outside this computer.

To commit finished exports, review the changes and stage the intended files:

```bash
git add users/kasey/config.json users/kasey/profiles users/kasey/exports
git commit -m "Save Kasey's weekly playlists"
git push
```

## Wax Weekly

[Wax Weekly](https://waxweekly.com) is the public listening site in `wax_weekly/`. It presents genre collections and daily playlists with song details and Spotify links.

**V2 site integration is still pending.** The local app publishes playlists and saves JSON snapshots, but the existing `weekly:site:build` script reads the older snapshot database format. It does not yet build the site from these v2 snapshots or add Electropop automatically. Publishing through the local app does not deploy the site.

## Troubleshooting

- **A collection needs a fix:** expand its source details on Collections, correct the CSV, and click **Refresh collection**.
- **The wrong user appears:** stop the server and restart with `WAX_USER=kasey npm run dev`; check that the config username matches.
- **Port 3000 is in use:** stop the previous server, or use `PORT=3001 WAX_USER=kasey npm run dev` and open port 3001.
- **CSV files show as unsaved after an edit:** save them again to export the new order. Opening choices still save automatically.
- **Spotify authorization fails:** check `.env`, run `npm run spotify:auth` again if needed, and restart the app.

## Development

```bash
npm run check
npm run build
WAX_USER=kasey npm start
```

The local app uses React, TypeScript, Vite, Express, Tailwind, shadcn/ui, and TanStack Query. Wax Weekly uses HTML, CSS, and JavaScript.

## License

MIT
