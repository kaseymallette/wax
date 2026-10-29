import { useMemo, useState } from "react";
import { angularPartition } from "../../../server/angularPartition";
import type { DailyPlaylist } from "../../../server/dailyPlaylists";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COLORS = ["#4ade80", "#60a5fa", "#fb923c", "#c084fc", "#f472b6", "#facc15", "#22d3ee"];

export function PlaylistMap({ playlists, name, disabled, onSelect }: {
  playlists: DailyPlaylist[];
  name: string;
  disabled: boolean;
  onSelect: (day: number, id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const { points, boundaries, labels, extent } = useMemo(() => {
    const tracks = playlists.flatMap(p => p.tracks.map(track => ({ ...track, day: p.index - 1 })));
    const partition = angularPartition(tracks.map(t => ({ id: t.id, bpm: t.bpm, valence: t.valence })));
    const coordinates = new Map(partition.points.map(p => [p.id, p]));
    return {
      points: tracks.map(t => ({ ...t, ...coordinates.get(t.id)! })),
      boundaries: partition.boundaries,
      labels: playlists.map(playlist => {
        const sector = coordinates.get(playlist.tracks[0].id)!.sector;
        const start = partition.boundaries[sector];
        const end = sector === partition.k - 1 ? Math.PI * 2 : partition.boundaries[sector + 1];
        return { day: playlist.index - 1, sector, angle: (start + end) / 2 };
      }),
      extent: Math.max(2, ...partition.points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.12,
    };
  }, [playlists]);
  const active = points.find(p => p.id === (hovered ?? selected));
  const centerX = 400, centerY = 280, halfWidth = 250, halfHeight = 220;
  const x = (value: number) => centerX + value / extent * halfWidth;
  const y = (value: number) => centerY - value / extent * halfHeight;
  return <details className="mb-6 rounded-2xl border border-border bg-card p-5" open>
    <summary className="cursor-pointer font-display text-lg font-bold">Playlist map · {name}</summary>
    <p className="mt-3 text-sm text-muted-foreground">Each dot is a song, colored by its day. Hover or focus for details; select a song to keep its details visible.</p>
    <p className="mt-4 min-h-10 text-center text-sm" aria-live="polite">{active ? <><strong>{active.name}</strong> — {active.artists}<br /><span className="text-muted-foreground">{DAYS[active.day]} · {active.bpm} BPM · Valence {active.valence}</span></> : "Hover over or select a song to see its details."}</p>
    <div className="mx-auto max-w-3xl">
      <svg viewBox="0 0 800 585" className="w-full" role="group" aria-label={`${name}: seven angular playlists plotted by standardized BPM and valence`}>
        <defs><clipPath id="playlist-map-clip"><rect x="150" y="60" width="500" height="440" /></clipPath></defs>
        <g pointerEvents="none">
          <text x="400" y="576" textAnchor="middle" fill="currentColor" fontSize="16" fontWeight="600" opacity="0.85">BPM</text>
          <text transform="translate(30 280) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="16" fontWeight="600" opacity="0.85">Valence</text>
        </g>
        <g clipPath="url(#playlist-map-clip)">
          {boundaries.map((angle, i) => <line key={i} x1={centerX} y1={centerY} x2={centerX + Math.cos(angle) * halfWidth * 4} y2={centerY - Math.sin(angle) * halfHeight * 4} stroke={COLORS[labels.find(label => label.sector === i)!.day]} strokeWidth="2.5" strokeDasharray="7 6" opacity="0.55" />)}
          {points.map(p => <circle key={p.id}
            cx={x(p.x)} cy={y(p.y)} r={4.5}
            fill={COLORS[p.day]} opacity={0.9}

            role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
            aria-label={`${p.name} by ${p.artists}, ${DAYS[p.day]}, ${p.bpm} BPM, valence ${p.valence}`}
            className="cursor-pointer focus:outline-none focus:stroke-current focus:stroke-2"
            onMouseEnter={() => setHovered(p.id)} onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(p.id)} onBlur={() => setHovered(null)}
            onClick={() => { if (!disabled) { setSelected(p.id); onSelect(p.day, p.id); } }}
            onKeyDown={event => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelected(p.id); onSelect(p.day, p.id); } }}>
            <title>{p.name} — {p.artists} · {DAYS[p.day]} · {p.bpm} BPM · Valence {p.valence}</title>
          </circle>)}
        </g>
        {labels.map(({ day: labelDay, angle }) => {
          const dx = Math.cos(angle), dy = -Math.sin(angle);
          const edge = 1 / Math.max(Math.abs(dx), Math.abs(dy));
          const labelX = centerX + dx * (halfWidth * edge + 58);
          const labelY = centerY + dy * (halfHeight * edge + 32);
          return <foreignObject key={labelDay} x={labelX - 57} y={labelY - 20} width="114" height="40">
            <div className="flex h-full w-full items-center justify-center gap-1.5 text-sm" style={{ color: COLORS[labelDay] }}>
              {DAYS[labelDay]}
            </div>
          </foreignObject>;
        })}
      </svg>
    </div>

    <p className="mt-2 text-xs text-muted-foreground">The center is this collection’s average. Tempo increases to the right; valence increases upward. Dividing lines mark angular group boundaries; songs on a tied boundary may belong to different days.</p>
  </details>;
}
