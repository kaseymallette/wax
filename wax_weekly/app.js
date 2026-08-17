(function () {
  const DATA = window.WAX_DATA;
  const ART = window.WAX_ART || {};
  const pendingArt = new Set();

  const STATIONS = {
    'kasey-alt-rock': { name: 'Alt Rock', accent: 'var(--accent-alt)', desc: 'Distortion, hooks, and heavy rotation.' },
    'kasey-classic-rock': { name: 'Classic Rock', accent: 'var(--accent-classic)', desc: 'The canon, spun front to back.' },
    'kasey-country-blues': { name: 'Country Blues', accent: 'var(--accent-country)', desc: 'Twang, grit, and twelve bars.' },
    'kasey-indie-folk': { name: 'Indie Folk', accent: 'var(--accent-indie)', desc: 'Quiet rooms and open tunings.' },
    'kasey-pop-hip-hop': { name: 'Pop & Hip-Hop', accent: 'var(--accent-pop)', desc: 'Big choruses, bigger bounce.' },
  };

  let currentStation = DATA.stations[0].id;
  let currentDay = 0;

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  /* ---------- Theme toggle ---------- */
  const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const toggle = document.querySelector('[data-theme-toggle]');
  let theme = 'dark';
  function applyTheme() {
    root.setAttribute('data-theme', theme);
    toggle.innerHTML = theme === 'dark' ? SUN : MOON;
    toggle.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
  }
  toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });
  applyTheme();

  /* ---------- Last updated label ---------- */
  const updatedText = 'August 16, 2026';
  $('week-label').textContent = 'Last updated on ' + updatedText;
  $('footer-week').textContent = updatedText;

  /* ---------- Station rail ---------- */
  const rail = $('station-rail');
  DATA.stations.forEach((s) => {
    const meta = STATIONS[s.id];
    const total = s.days.reduce((n, d) => n + d.tracks.length, 0);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'station-card';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.station = s.id;
    btn.style.setProperty('--sc', meta.accent);
    btn.innerHTML =
      '<span class="station-genre">' + meta.name + '</span>' +
      '<span class="station-count">' + total + ' tracks · 7 days</span>';
    btn.addEventListener('click', () => {
      currentStation = s.id;
      render();
    });
    rail.appendChild(btn);
  });

  /* ---------- Day rail ---------- */
  const dayRail = $('day-rail');
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  DAY_SHORT.forEach((d, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-pill';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.textContent = d;
    btn.addEventListener('click', () => {
      currentDay = i;
      render();
    });
    dayRail.appendChild(btn);
  });

  /* ---------- Helpers ---------- */
  function station() {
    return DATA.stations.find((s) => s.id === currentStation);
  }
  function avg(tracks, key) {
    const vals = tracks.map((t) => t[key]).filter((v) => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function animateNumber(el, target, decimals) {
    const start = performance.now();
    const dur = 400;
    const from = parseFloat(el.dataset.val || '0') || 0;
    function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      el.textContent = v.toFixed(decimals);
      if (p < 1) requestAnimationFrame(tick);
      else el.dataset.val = target;
    }
    requestAnimationFrame(tick);
  }

  function trackId(u) {
    const m = /\/track\/([A-Za-z0-9]+)/.exec(u || '');
    return m ? m[1] : null;
  }

  const LINKOUT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>';
  const PLAY = '<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.79-6.86a1 1 0 0 0 0-1.68L9.54 4.3C8.87 3.87 8 4.35 8 5.14z"/></svg>';
  const PAUSE = '<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const VINYL = '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="currentColor" opacity="0.15"/><circle cx="22" cy="22" r="8" fill="currentColor" opacity="0.28"/><circle cx="22" cy="22" r="2" fill="currentColor" opacity="0.55"/></svg>';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- Render ---------- */
  function render() {
    const s = station();
    const meta = STATIONS[s.id];
    const day = s.days[currentDay];
    const tracks = day.tracks;

    root.style.setProperty('--accent', meta.accent);

    rail.querySelectorAll('.station-card').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.station === s.id));
    });
    dayRail.querySelectorAll('.day-pill').forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === currentDay));
    });

    $('station-title').textContent = meta.name;
    $('station-desc').innerHTML = '<span class="week-desc-line">' + esc(meta.desc) + '</span><span class="week-desc-line week-desc-format">Seven playlists for each day of the week.</span>';
    $('playlist-eyebrow').textContent = meta.name + ' · Playlist ' + (currentDay + 1) + ' of 7';
    $('playlist-day').textContent = day.day;

    const playlistLink = $('playlist-link');
    if (day.playlist_url) {
      playlistLink.href = day.playlist_url;
      playlistLink.hidden = false;
      playlistLink.setAttribute('aria-label', 'Play the ' + meta.name + ' ' + day.day + ' playlist on Spotify');
    } else {
      playlistLink.hidden = true;
      playlistLink.removeAttribute('href');
    }

    animateNumber($('stat-tracks'), tracks.length, 0);
    animateNumber($('stat-bpm'), avg(tracks, 'bpm') || 0, 0);
    animateNumber($('stat-mood'), avg(tracks, 'm') || 0, 0);
    animateNumber($('stat-energy'), avg(tracks, 'e') || 0, 0);
    animateNumber($('stat-dance'), avg(tracks, 'd') || 0, 0);
    animateNumber($('stat-valence'), avg(tracks, 'v') || 0, 0);

    const list = $('track-list');
    list.innerHTML =
      '<li class="track-cols" role="presentation"><span class="col-rank">#</span><span class="col-play"></span><span class="col-track">Track</span><span class="col-album">Album</span><span class="col-bpm">BPM</span><span class="col-key">Key</span><span class="col-mood">Mood</span><span class="col-components"><span>Components</span><span class="component-info-group"><span class="component-info-wrap"><button type="button" class="info-button component-info-button" aria-describedby="components-help" aria-label="What the component abbreviations mean">i</button><span class="component-info-tooltip" id="components-help" role="tooltip">E = Energy · D = Danceability · V = Valence. Each component is scored from 0–100.</span></span><span class="component-info-wrap"><button type="button" class="info-button component-info-button" aria-describedby="mood-formula-help" aria-label="How the mood score is calculated">i</button><span class="component-info-tooltip mood-formula-tooltip" id="mood-formula-help" role="tooltip">Mood = Energy + Danceability + Valence, so each song’s Mood score ranges from 0–300.</span></span></span></span><span class="col-x"></span></li>' +
      tracks
        .map((t) => {
          const id = trackId(t.u);
          const art = id && ART[id] ? ART[id] : null;
          const components =
            '<span class="component-value"><b>E</b> ' + Math.round(t.e || 0) + '</span>' +
            '<span class="component-sep">·</span>' +
            '<span class="component-value"><b>D</b> ' + Math.round(t.d || 0) + '</span>' +
            '<span class="component-sep">·</span>' +
            '<span class="component-value"><b>V</b> ' + Math.round(t.v || 0) + '</span>';
          const artInner = art
            ? '<img class="art-img" src="' + esc(art) + '" alt="" loading="lazy" decoding="async" width="48" height="48" />'
            : '<span class="art-img art-fallback">' + VINYL + '</span>';
          return (
            '<li class="track" data-id="' + (id || '') + '">' +
            '<div class="track-row">' +
            '<span class="track-rank">' + t.n + '</span>' +
            '<button type="button" class="play-btn" aria-expanded="false" aria-label="Play 30 second preview of ' + esc(t.t) + ' by ' + esc(t.a) + '">' +
              artInner +
              '<span class="play-overlay" aria-hidden="true">' + PLAY + '</span>' +
            '</button>' +
            '<span class="track-main"><span class="track-name">' + esc(t.t) + '</span><span class="track-artist">' + esc(t.a) + '</span></span>' +
            '<span class="track-album">' + esc(t.al) + '</span>' +
            '<span class="track-bpm">' + (t.bpm != null ? Math.round(t.bpm) : '–') + '</span>' +
            '<span class="track-key">' + (t.k || '–') + '</span>' +
            '<span class="track-mood">' + (t.m != null ? Math.round(t.m) : '–') + '</span>' +
            '<span class="track-components">' + components + '</span>' +
            (t.u
              ? '<a class="track-link" href="' + esc(t.u) + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + esc(t.t) + ' on Spotify">' + LINKOUT + '</a>'
              : '<span></span>') +
            '</div>' +
            '<div class="track-embed" hidden></div>' +
            '</li>'
          );
        })
        .join('');

    loadArtFor(tracks);
  }

  /* ---------- Lazy album art ---------- */
  // Covers are fetched on demand for the visible day only (~25 requests),
  // then cached in memory so switching back is instant.
  function loadArtFor(tracks) {
    tracks.forEach((t) => {
      const id = trackId(t.u);
      if (!id || ART[id] || pendingArt.has(id)) return;
      pendingArt.add(id);
      const url =
        'https://open.spotify.com/oembed?url=' +
        encodeURIComponent('https://open.spotify.com/track/' + id);
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const thumb = j && j.thumbnail_url;
          if (!thumb) return;
          ART[id] = thumb;
          document.querySelectorAll('.track[data-id="' + id + '"] .art-img').forEach((el) => {
            const img = document.createElement('img');
            img.className = 'art-img';
            img.src = thumb;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.width = 48;
            img.height = 48;
            if (el.tagName === 'IMG') el.src = thumb;
            else el.replaceWith(img);
          });
        })
        .catch(() => {})
        .finally(() => pendingArt.delete(id));
    });
  }

  /* ---------- Inline preview player ---------- */
  const list = $('track-list');

  function closeEmbed(li) {
    const btn = li.querySelector('.play-btn');
    const overlay = btn.querySelector('.play-overlay');
    const embed = li.querySelector('.track-embed');
    btn.setAttribute('aria-expanded', 'false');
    overlay.innerHTML = PLAY;
    embed.hidden = true;
    embed.innerHTML = '';
  }

  function toggleEmbed(li) {
    const id = li.dataset.id;
    if (!id) return;
    const btn = li.querySelector('.play-btn');
    const overlay = btn.querySelector('.play-overlay');
    const embed = li.querySelector('.track-embed');
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    list.querySelectorAll('.track').forEach((other) => {
      if (other !== li) closeEmbed(other);
    });
    if (isOpen) {
      closeEmbed(li);
      return;
    }
    btn.setAttribute('aria-expanded', 'true');
    overlay.innerHTML = PAUSE;
    embed.hidden = false;
    embed.innerHTML =
      '<iframe src="https://open.spotify.com/embed/track/' + id + '?utm_source=generator" width="100%" height="80" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify preview player"></iframe>';
  }

  list.addEventListener('click', (e) => {
    if (e.target.closest('.track-link')) return;
    const btn = e.target.closest('.play-btn');
    if (!btn) return;
    toggleEmbed(btn.closest('.track'));
  });

  render();
})();
