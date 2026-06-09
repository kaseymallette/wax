export function PlaybackSection({
  trackId,
  previewUrl,
}: {
  trackId: string;
  previewUrl?: string | null;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground" data-testid="text-playback-hint">
        Embed plays the full song if you're logged into Spotify in this browser
        (Premium = full, Free = 30s).
      </p>
      <div className="overflow-hidden rounded-xl border border-border">
        <iframe
          title="Spotify player"
          data-testid="iframe-spotify-embed"
          src={`https://open.spotify.com/embed/track/${trackId}?utm_source=generator`}
          width="100%"
          height={152}
          frameBorder={0}
          allow="encrypted-media; autoplay; clipboard-write; fullscreen; picture-in-picture"
          loading="lazy"
          style={{ display: "block" }}
        />
      </div>
      {previewUrl ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            30-sec preview (no login needed)
          </p>
          <audio
            controls
            src={previewUrl}
            className="w-full"
            data-testid="audio-preview"
          />
        </div>
      ) : null}
    </div>
  );
}
