import { useState } from "react";

// Deterministic warm gradient from a seed string.
function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${h} 45% 28%), hsl(${h2} 55% 18%))`;
}

export function AlbumArt({
  url,
  name,
  size = 280,
  className = "",
}: {
  url?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        className={`aspect-square w-full rounded-lg object-cover shadow-lg shadow-black/30 ${className}`}
        style={{ maxWidth: size }}
        data-testid="img-album-art"
      />
    );
  }

  return (
    <div
      className={`flex aspect-square w-full items-center justify-center rounded-lg shadow-lg shadow-black/30 ${className}`}
      style={{ background: gradientFor(name || "x"), maxWidth: size }}
      data-testid="img-album-art-fallback"
    >
      <span className="font-display text-6xl font-extrabold text-white/85">{initial}</span>
    </div>
  );
}
