export type AngularPoint = { id: string; bpm: number; valence: number };
export type AngularMode = "equal-angle" | "equal-count";
export const TAU = 2 * Math.PI;
export const wrapAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Population standardization; canonical ID order makes fitting independent of input order. */
export function standardizeAngularPoints(points: readonly AngularPoint[]) {
  if (!points.length) throw new Error("At least one point is required.");
  const ids = new Set<string>();
  for (const p of points) {
    if (!p.id.trim() || ids.has(p.id)) throw new Error("Point IDs must be nonempty and unique.");
    ids.add(p.id);
    if (!Number.isFinite(p.bpm) || p.bpm <= 0 || !Number.isFinite(p.valence) || p.valence < 0 || p.valence > 100) {
      throw new Error(`Invalid BPM or valence for ${p.id}`);
    }
  }
  const sorted = [...points].sort(compareId);
  const stats = (key: "bpm" | "valence") => {
    const mean = sorted.reduce((s, p) => s + p[key], 0) / sorted.length;
    const sd = Math.sqrt(sorted.reduce((s, p) => s + (p[key] - mean) ** 2, 0) / sorted.length);
    return { mean, sd, scale: sd || 1 };
  };
  const bpm = stats("bpm"), valence = stats("valence");
  const normalized = points.map(p => {
    const x = (p.bpm - bpm.mean) / bpm.scale, y = (p.valence - valence.mean) / valence.scale;
    const radius = Math.hypot(x, y);
    return { ...p, x, y, radius, angle: radius === 0 ? 0 : wrapAngle(Math.atan2(y, x)) };
  });
  return { points: normalized, bpm, valence,
    centerCount: normalized.filter(p => p.radius === 0).length,
    warnings: [bpm.sd === 0 ? "BPM is constant; scale set to 1." : "", valence.sd === 0 ? "Valence is constant; scale set to 1." : ""].filter(Boolean) };
}

export function angularPartition(points: readonly AngularPoint[], options: { k?: number; mode?: AngularMode; rotation?: number } = {}) {
  const { k = 7, mode = "equal-count", rotation = 0 } = options;
  if (!Number.isInteger(k) || k < 1 || k > points.length) throw new Error("k must be an integer between 1 and the point count.");
  if (mode !== "equal-angle" && mode !== "equal-count") throw new Error("Unknown angular partition mode.");
  if (!Number.isFinite(rotation)) throw new Error("Rotation must be finite.");
  const fitted = standardizeAngularPoints(points);
  const seam = wrapAngle(rotation);
  const ranked = fitted.points.map(p => ({ ...p, relativeAngle: wrapAngle(p.angle - seam), sector: 0 }))
    .sort((a, b) => a.relativeAngle - b.relativeAngle || compareId(a, b));
  const boundaries = [seam];
  let splitAngleTies = 0;
  if (mode === "equal-angle") {
    for (const p of ranked) p.sector = Math.min(k - 1, Math.floor(p.relativeAngle / (TAU / k)));
    for (let i = 1; i < k; i++) boundaries.push(wrapAngle(seam + i * TAU / k));
  } else {
    let offset = 0;
    for (let sector = 0; sector < k; sector++) {
      if (offset) {
        const left = ranked[offset - 1].relativeAngle, right = ranked[offset].relativeAngle;
        if (left === right) splitAngleTies++;
        boundaries.push(wrapAngle(seam + (left + right) / 2));
      }
      const capacity = Math.floor(points.length / k) + (sector < points.length % k ? 1 : 0);
      for (let i = 0; i < capacity; i++) ranked[offset++].sector = sector;
    }
  }
  const byId = new Map(ranked.map(p => [p.id, p]));
  return { ...fitted, points: points.map(p => byId.get(p.id)!), boundaries, splitAngleTies, k, mode, rotation: seam };
}
