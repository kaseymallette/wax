import { test } from "node:test";
import assert from "node:assert/strict";
import { angularPartition, TAU } from "./angularPartition";
import { readProfileTracks } from "./profileConfig";

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(4, "0"), bpm: 60 + i % 140, valence: i * 17 % 101 }));
test("balanced coverage, reordering invariance, and nondivisible sizes", () => {
  for (const n of [7, 8, 70, 193, 210, 700]) {
    const input = points(n), result = angularPartition(input);
    const counts = Array.from({ length: 7 }, (_, i) => result.points.filter(p => p.sector === i).length);
    assert.equal(Math.max(...counts) - Math.min(...counts) <= 1, true);
    assert.deepEqual(result.points.map(p => p.id).sort(), input.map(p => p.id).sort());
    const mapping = (ps: typeof result.points) => ps.map(p => [p.id, p.sector]).sort();
    assert.deepEqual(mapping(angularPartition([...input].reverse()).points), mapping(result.points));
    assert.deepEqual(angularPartition(input), result);
  }
});
test("cardinal boundaries, seam, and rotation use half-open sectors", () => {
  const input = [
    { id: "east", bpm: 110, valence: 50 }, { id: "north", bpm: 100, valence: 60 },
    { id: "west", bpm: 90, valence: 50 }, { id: "south", bpm: 100, valence: 40 },
  ];
  const labels = (rotation: number) => angularPartition(input, { k: 4, mode: "equal-angle", rotation }).points.map(p => p.sector);
  assert.deepEqual(labels(0), [0, 1, 2, 3]);
  assert.deepEqual(labels(TAU), labels(0));
  assert.deepEqual(labels(Math.PI / 2), [3, 0, 1, 2]);
  assert.deepEqual(labels(-Math.PI / 2), [1, 2, 3, 0]);
});
test("ties and undefined center directions are explicit and deterministic", () => {
  const input = points(14).map(p => ({ ...p, bpm: 100, valence: 50 }));
  const result = angularPartition(input);
  assert.equal(result.centerCount, 14);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.splitAngleTies, 6);
  assert.deepEqual(result.points.map(p => p.sector), input.map((_, i) => Math.floor(i / 2)));
  assert.ok(angularPartition(input, { mode: "equal-angle" }).points.every(p => p.sector === 0));
  assert.equal(angularPartition([{ id: "one", bpm: 100, valence: 0 }], { k: 1 }).points[0].sector, 0);
});
test("invalid inputs are rejected rather than silently dropped", () => {
  for (const input of [[], [{ id: "", bpm: 100, valence: 50 }], [{ id: "a", bpm: NaN, valence: 50 }], [{ id: "a", bpm: 100, valence: 101 }], [{ id: "a", bpm: 0, valence: 50 }]]) {
    assert.throws(() => angularPartition(input, { k: 1 }));
  }
  assert.throws(() => angularPartition([points(1)[0], points(1)[0]], { k: 1 }));
  for (const k of [0, 1.5, 8, NaN]) assert.throws(() => angularPartition(points(7), { k }));
  assert.throws(() => angularPartition(points(7), { rotation: Infinity }));
});
test("real source assigns every track once to seven groups of thirty", () => {
  const source = readProfileTracks("users/kasey/profiles/pop-hip-hop.csv");
  const result = angularPartition(source);
  assert.equal(source.length, 210);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => result.points.filter(p => p.sector === i).length), Array(7).fill(30));
  assert.equal(new Set(result.points.map(p => p.id)).size, 210);
  assert.ok(Math.abs(result.points.reduce((s, p) => s + p.x, 0)) < 1e-10);
  assert.ok(Math.abs(result.points.reduce((s, p) => s + p.y, 0)) < 1e-10);
});
