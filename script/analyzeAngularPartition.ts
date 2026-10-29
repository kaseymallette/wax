import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { angularPartition, TAU } from "../server/angularPartition";
import { readProfileTracks } from "../server/profileConfig";
import { buildDailyPlaylists } from "../server/dailyPlaylists";

const input = process.argv[2] ?? "users/kasey/profiles/pop-hip-hop.csv";
const output = process.argv[3] ?? "features/angular-partition/results";
const degrees = Number(process.argv[4] ?? 0);
const source = fs.readFileSync(input, "utf8");
const sourceRows = Papa.parse<Record<string, string>>(source, { header: true, skipEmptyLines: "greedy" }).data;
const tracks = readProfileTracks(input);
const equalCount = angularPartition(tracks, { rotation: degrees * Math.PI / 180 });
const equalAngle = angularPartition(tracks, { mode: "equal-angle", rotation: degrees * Math.PI / 180 });
const points = equalCount.points;
const radial = [...points].sort((a, b) => a.radius - b.radius || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const ringIds = new Map<string, number>();
const ringBoundaries: number[] = [];
let offset = 0;
for (let group = 0; group < 7; group++) {
  if (offset) ringBoundaries.push((radial[offset - 1].radius + radial[offset].radius) / 2);
  const count = Math.floor(points.length / 7) + (group < points.length % 7 ? 1 : 0);
  for (let j = 0; j < count; j++) ringIds.set(radial[offset++].id, group);
}
// Same production implementation, with Mood = Valence in this in-memory comparison only.
const baseline = buildDailyPlaylists(tracks.map(t => ({ ...t, energy: 0, dance: 0 })), { grouping: "kmeans" });
const kmeansIds = new Map(baseline.playlists.flatMap((p, i) => p.tracks.map(t => [t.id, i] as const)));
const methods = [
  { name: "Equal-count angles", ids: new Map(points.map(p => [p.id, p.sector])), rays: equalCount.boundaries },
  { name: "Equal-angle sectors", ids: new Map(equalAngle.points.map(p => [p.id, p.sector])), rays: equalAngle.boundaries },
  { name: "Equal-count rings", ids: ringIds, rays: [] as number[] },
  { name: "Balanced K-means", ids: kmeansIds, rays: [] as number[] },
];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const summaries = methods.map(method => {
  const groups = Array.from({ length: 7 }, (_, group) => {
    const members = points.filter(p => method.ids.get(p.id) === group);
    if (!members.length) return { group: group + 1, count: 0, meanBpm: null, meanValence: null, minRadius: null, maxRadius: null, sse: 0 };
    const cx = mean(members.map(p => p.x)), cy = mean(members.map(p => p.y));
    return { group: group + 1, count: members.length, meanBpm: mean(members.map(p => p.bpm)), meanValence: mean(members.map(p => p.valence)),
      minRadius: Math.min(...members.map(p => p.radius)), maxRadius: Math.max(...members.map(p => p.radius)),
      sse: members.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) };
  });
  if (groups.reduce((s, g) => s + g.count, 0) !== tracks.length || method.ids.size !== tracks.length || points.some(p => !method.ids.has(p.id))) throw new Error("Assignment coverage failed.");
  return { name: method.name, groups, sse: groups.reduce((s, g) => s + g.sse, 0) };
});
const report = {
  source: input, sha256: createHash("sha256").update(source).digest("hex"), count: tracks.length,
  rotationDegrees: degrees, bpm: equalCount.bpm, valence: equalCount.valence,
  centerCount: equalCount.centerCount, nearCenterCount: points.filter(p => p.radius < 0.25).length,
  nearCenterRadiusThreshold: 0.25, splitAngleTies: equalCount.splitAngleTies, warnings: equalCount.warnings,
  boundariesDegrees: { equalCount: equalCount.boundaries.map(a => a * 180 / Math.PI), equalAngle: equalAngle.boundaries.map(a => a * 180 / Math.PI) },
  methods: summaries,
};

// Standalone SVG figures: all marks derive from the computed assignments above.
const colors = ["#54afe1", "#52c3a1", "#dbc25d", "#b78bd3", "#ed947c", "#8f9cf1", "#d685ad"];
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const text = (x: number, y: number, value: string, size = 15, anchor = "start") => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${esc(value)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = "#34414e", extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" ${extra}/>`;
const svg = (width: number, height: number, title: string, content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="100%" height="100%" fill="#10151c"/><g font-family="Arial, sans-serif" fill="#edf1f5">${content}</g></svg>`;
const extent = Math.ceil(Math.max(...points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))) + 0.25;
let chart = text(36, 42, "BPM × valence · Four ways to partition one collection", 26);
chart += text(36, 72, `${tracks.length} songs · 7 groups · rotation ${degrees}° · population-standardized coordinates`, 16);
methods.forEach((method, index) => {
  const ox = 36 + (index % 2) * 530, oy = 106 + Math.floor(index / 2) * 530;
  const left = ox + 58, top = oy + 42, size = 410;
  const X = (v: number) => left + size / 2 + v * size / (extent * 2);
  const Y = (v: number) => top + size / 2 - v * size / (extent * 2);
  chart += text(ox, oy + 16, method.name, 22);
  chart += `<defs><clipPath id="p${index}"><rect x="${left}" y="${top}" width="${size}" height="${size}"/></clipPath></defs>`;
  for (let tick = Math.ceil(-extent); tick <= Math.floor(extent); tick++) {
    chart += line(X(tick), top, X(tick), top + size) + line(left, Y(tick), left + size, Y(tick));
    chart += text(X(tick), top + size + 22, String(tick), 13, "middle") + text(left - 10, Y(tick) + 4, String(tick), 13, "end");
  }
  chart += `<g clip-path="url(#p${index})">`;
  method.rays.forEach((a, i) => {
    const end = method.rays[(i + 1) % 7];
    const span = (end - a + TAU) % TAU;
    const r = extent * 3;
    chart += `<path d="M ${X(0)} ${Y(0)} L ${X(r * Math.cos(a))} ${Y(r * Math.sin(a))} A ${r * size / (extent * 2)} ${r * size / (extent * 2)} 0 ${span > Math.PI ? 1 : 0} 0 ${X(r * Math.cos(a + span))} ${Y(r * Math.sin(a + span))} Z" fill="${colors[i]}" opacity="0.07"/>`;
    chart += line(X(0), Y(0), X(r * Math.cos(a)), Y(r * Math.sin(a)), colors[i], 'opacity="0.65"');
  });
  if (index === 2) ringBoundaries.forEach((r, i) => { chart += `<circle cx="${X(0)}" cy="${Y(0)}" r="${r * size / (extent * 2)}" fill="none" stroke="${colors[i]}" opacity="0.65"/>`; });
  points.forEach(p => { chart += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.4" fill="${colors[method.ids.get(p.id)!]}" opacity="0.9"><title>${esc(tracks.find(t => t.id === p.id)!.name)} · group ${method.ids.get(p.id)! + 1} · ${p.bpm} BPM · ${p.valence} valence</title></circle>`; });
  chart += `</g><path d="M ${X(0) - 8} ${Y(0)} h 16 M ${X(0)} ${Y(0) - 8} v 16" stroke="#ffffff" stroke-width="2"/>`;
  chart += text(left + size / 2, top + size + 48, "BPM (standard deviations)", 15, "middle");
  chart += `<text transform="translate(${ox + 15},${top + size / 2}) rotate(-90)" font-size="15" text-anchor="middle">Valence (standard deviations)</text>`;
  chart += text(left, top + size + 73, `Group counts: ${summaries[index].groups.map(g => g.count).join(" / ")}   ·   SSE ${summaries[index].sse.toFixed(1)}`, 14);
});
colors.forEach((color, i) => { chart += `<circle cx="${82 + i * 143}" cy="1190" r="5" fill="${color}"/>` + text(94 + i * 143, 1195, `Group ${i + 1}`, 14); });
chart += text(36, 1233, "White cross = collection centroid. Group numbers are local to each method; they are not weekday assignments.", 14);

let dist = text(36, 42, "Balance and distance from the collection center", 25);
const maxCount = Math.max(...summaries.flatMap(m => m.groups.map(g => g.count)));
const maxRadius = Math.ceil(Math.max(...points.map(p => p.radius)));
summaries.forEach((method, index) => {
  const ox = 36 + (index % 2) * 530, oy = 92 + Math.floor(index / 2) * 360;
  dist += text(ox, oy, method.name, 22);
  dist += text(ox + 50, oy + 28, "Songs", 14) + text(ox + 268, oy + 28, "Radius: min — max", 14);
  method.groups.forEach((g, i) => {
    const y = oy + 55 + i * 31;
    dist += text(ox, y + 5, `G${i + 1}`, 14);
    dist += `<rect x="${ox + 50}" y="${y - 9}" width="${g.count / maxCount * 145}" height="18" fill="${colors[i]}"/>`;
    dist += text(ox + 58 + g.count / maxCount * 145, y + 5, String(g.count), 14);
    if (g.minRadius !== null && g.maxRadius !== null) {
      const x1 = ox + 268 + g.minRadius / maxRadius * 200, x2 = ox + 268 + g.maxRadius / maxRadius * 200;
      dist += line(x1, y, x2, y, colors[i], 'stroke-width="4"');
      dist += `<circle cx="${x1}" cy="${y}" r="4" fill="${colors[i]}"/><circle cx="${x2}" cy="${y}" r="4" fill="${colors[i]}"/>`;
    }
  });
  for (let tick = 0; tick <= maxRadius; tick++) dist += text(ox + 268 + tick / maxRadius * 200, oy + 280, String(tick), 13, "middle");
  dist += text(ox + 368, oy + 306, "Standardized Euclidean distance", 13, "middle");
});

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(output, "assignments.csv"), Papa.unparse(points.map((p, i) => ({
  SourceRecord: i + 1, OriginalNumber: sourceRows[i]["#"], SpotifyTrackId: p.id, Song: tracks[i].name, Artist: tracks[i].artists,
  BPM: p.bpm, Valence: p.valence, zBPM: p.x, zValence: p.y, AngleDegrees: p.angle * 180 / Math.PI, Radius: p.radius,
  EqualCountSector: p.sector + 1, EqualAngleSector: equalAngle.points[i].sector + 1, Ring: ringIds.get(p.id)! + 1, KMeansGroup: kmeansIds.get(p.id)! + 1,
}))) + "\n");
fs.writeFileSync(path.join(output, "partitions.svg"), svg(1100, 1260, "Four partition methods in standardized BPM and valence", chart));
fs.writeFileSync(path.join(output, "distributions.svg"), svg(1100, 790, "Group counts and radial ranges for four partition methods", dist));
const markdown = `# Measured results\n\nSource: \`${input}\` (${tracks.length} validated songs). SHA-256: \`${report.sha256}\`.\n\nCentroid: **${equalCount.bpm.mean.toFixed(2)} BPM, ${equalCount.valence.mean.toFixed(2)} valence**. Population standard deviations: ${equalCount.bpm.sd.toFixed(2)} BPM and ${equalCount.valence.sd.toFixed(2)} valence. Rotation: ${degrees}°.\n\n| Method | Group counts | Within-group SSE |\n| --- | --- | ---: |\n${summaries.map(m => `| ${m.name} | ${m.groups.map(g => g.count).join(", ")} | ${m.sse.toFixed(2)} |`).join("\n")}\n\nEvery method assigns all ${tracks.length} source IDs exactly once. Equal-count angular boundaries split ${equalCount.splitAngleTies} exact angle ties. There are ${report.centerCount} exact-centroid songs and ${report.nearCenterCount} songs within radius 0.25 (a descriptive threshold, not an exclusion).\n\n## Equal-count sector profiles\n\n| Sector | Songs | Mean BPM | Mean valence | Min radius | Max radius |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${summaries[0].groups.map(g => `| ${g.group} | ${g.count} | ${g.meanBpm?.toFixed(1)} | ${g.meanValence?.toFixed(1)} | ${g.minRadius?.toFixed(2)} | ${g.maxRadius?.toFixed(2)} |`).join("\n")}\n\n## Interpretation\n\nEqual-count angular groups guarantee balance while retaining direction; their angular widths adapt to the sample density. Equal-angle sectors provide fixed geometry but do not guarantee balance. Radial bands group central and extreme songs separately. SSE describes compactness in the same standardized feature space for every method; it does not measure listening quality. K-means here uses BPM and valence, not production's BPM and composite Mood.\n\nThe reference screenshots describe 210 songs but one displayed count totals 209. These outputs are computed from the local CSV and checked by ID coverage rather than copied from those screenshots.\n\n${report.warnings.length ? "Warnings: " + report.warnings.join(" ") : "No constant-feature warnings."}\n\n![Partitions](partitions.svg)\n\n![Counts and radii](distributions.svg)\n`;
fs.writeFileSync(path.join(output, "results.md"), markdown);
console.log(JSON.stringify({ output, count: tracks.length, centroid: [equalCount.bpm.mean, equalCount.valence.mean], methods: summaries.map(m => ({ name: m.name, counts: m.groups.map(g => g.count), sse: m.sse })) }, null, 2));
