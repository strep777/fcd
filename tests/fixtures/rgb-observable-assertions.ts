import { expect } from 'vitest';
import { height, width, type Fixture } from './rgb-observable-policy';

export type ObservedRegions = { regions: { indices: number[] }[] };

export function assertUniqueCoverage(rgba: Uint8Array, result: ObservedRegions) {
  const counts = new Uint16Array(width * height);
  let indicesInBounds = true;
  for (const region of result.regions) for (const index of region.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= counts.length) indicesInBounds = false;
    else counts[index]++;
  }
  expect(indicesInBounds, 'region indices are inside the observation').toBe(true);
  expect(Array.from(counts).every((n, i) => n === (rgba[i * 4 + 3] >= 128 ? 1 : 0)), 'each opaque observation is owned once; missing observations are unclaimed').toBe(true);
}

export function neighbors(labels: Int32Array) {
  const b = labels[20 * width + 12], y = labels[40 * width + 82];
  expect(b).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(b).not.toBe(y);
  for (let row = 0; row < height; row++) {
    expect(labels[row * width + 12], 'independent deep blue column').toBe(b);
    expect(labels[row * width + 82], 'independent deep yellow column').toBe(y);
  }
  return { b, y };
}

export function isConnected(indices: number[]) {
  if (!indices.length) return false;
  const remaining = new Set(indices), stack = [indices[0]];
  remaining.delete(indices[0]);
  while (stack.length) {
    const i = stack.pop()!, x = i % width;
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, i - width, i + width]) {
      if (n >= 0 && n < width * height && remaining.delete(n)) stack.push(n);
    }
  }
  return remaining.size === 0;
}

// Source support must be created before classification. Labels only answer
// whether one independent owner carries this already fixed observed signal.
export function assertObservedStripe(result: ObservedRegions, labels: Int32Array, support: number[]) {
  expect(isConnected(support)).toBe(true);
  for (let row = 0; row < height; row++) expect(support.some(i => Math.floor(i / width) === row)).toBe(true);
  const { b, y } = neighbors(labels), supportSet = new Set(support);
  const third = Array.from(new Set(support.map(i => labels[i]).filter(id => id !== b && id !== y)));
  expect(third, 'one owner carries the extended third source signal').toHaveLength(1);
  const ribbon = result.regions[third[0]].indices.filter(i => supportSet.has(i));
  expect(isConnected(ribbon), 'source-supported ribbon remains continuous').toBe(true);
  for (let row = 0; row < height; row++) expect(ribbon.some(i => Math.floor(i / width) === row), 'third owner reaches every source row').toBe(true);
  expect(result.regions).toHaveLength(3);
}

export function assertCompactOwnership(result: ObservedRegions, labels: Int32Array, spec: Fixture) {
  const owners = neighbors(labels);
  expect(result.regions).toHaveLength(2);
  for (let y = 36; y < 36 + spec.size; y++) for (let x = 20; x < 20 + spec.size; x++) {
    expect(labels[y * width + x], 'ambiguous compact observation shares surrounding blue owner').toBe(owners.b);
  }
}
