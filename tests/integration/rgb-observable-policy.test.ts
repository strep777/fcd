import { expect, it } from 'vitest';
import { illustrationRegions } from '../../packages/reference/illustration';
import { ambiguousCompact, height, nameOf, observedSource, sampledSource, sourceRibbon, white, width, type Fixture } from '../fixtures/rgb-observable-policy';
import { assertCompactOwnership, assertObservedStripe, assertUniqueCoverage, isConnected, neighbors } from '../fixtures/rgb-observable-assertions';

function classify(rgba: Uint8Array) {
  const before = rgba.slice();
  const result = illustrationRegions(width, height, rgba, false, 'head');
  const labels = new Int32Array(width * height).fill(-1);
  const counts = new Uint8Array(width * height);
  result.regions.forEach((region, id) => region.indices.forEach(i => { counts[i]++; labels[i] = id; }));
  expect(rgba).toEqual(before);
  expect(Array.from(counts).every(n => n === 1), 'each opaque observation has exactly one owner').toBe(true);
  assertUniqueCoverage(rgba, result);
  return { labels, regions: result.regions };
}

it.each([1, 2])('retains the observed continuous %ipx stripe after blur3', async size => {
  const rgba = await observedSource({ kind: 'line', size, blur: 3 }, 'paint');
  // This source-only support is fixed before extraction. It does not use a
  // region representative, output labels, or the floored latent white center.
  const support = sourceRibbon(rgba);
  const result = classify(rgba);
  assertObservedStripe(result, result.labels, support);
});

it.each(ambiguousCompact)('$kind $size px blur $blur has the same merge-preferred output under both physical interpretations', async spec => {
  // This explicitly enumerated compact-fixture policy must not become a
  // universal rule that every bright observation without exact white is noise.
  expect(sampledSource(spec, 'reflection')).toEqual(sampledSource(spec, 'paint'));
  const paint = await observedSource(spec, 'paint'), reflection = await observedSource(spec, 'reflection');
  expect(reflection, `${nameOf(spec)}: entire decoded RGBA, including alpha`).toEqual(paint);
  // Both calls have identical width, height, RGBA, mode and extraction context.
  // Physical interpretation, latent material and reflection field never enter API.
  const a = classify(paint), b = classify(reflection);
  expect(b.labels).toEqual(a.labels);
  expect(b.regions.map(r => ({ color: r.color, indices: r.indices }))).toEqual(a.regions.map(r => ({ color: r.color, indices: r.indices })));
  for (const result of [a, b]) {
    assertCompactOwnership(result, result.labels, spec);
  }
});

it.each(['hole', 'line'] as const)('preserves the independently observed neutral core of a clear 4px %s', async kind => {
  const spec: Fixture = { kind, size: 4, blur: .6 }, rgba = await observedSource(spec, 'paint');
  // Exact fixture neutral plateau: no new size, brightness, contribution or
  // family threshold. This is a positive control, not a general inverse-optics proof.
  const core = Array.from({ length: width * height }, (_, i) => i)
    .filter(i => rgba[i * 4 + 3] === 255 && white.every((v, c) => rgba[i * 4 + c] === v));
  expect(core.length).toBeGreaterThan(0);
  expect(isConnected(core)).toBe(true);
  const { labels, regions } = classify(rgba), { b, y } = neighbors(labels);
  const owners = new Set(core.map(i => labels[i]));
  expect(owners.size).toBe(1);
  expect(owners.has(b)).toBe(false);
  expect(owners.has(y)).toBe(false);
  expect(regions).toHaveLength(3);
});
