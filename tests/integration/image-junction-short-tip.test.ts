import {expect, it} from 'vitest';
import {sourceJunctions} from '../../packages/reference/image-tip-junctions';
import type {Point} from '../../packages/schema/index';

type XY = {xMm: number; yMm: number};
const point = (xMm: number, yMm: number, id: string): Point => ({xMm, yMm, id});
const palette = {A: [240, 220, 40], B: [35, 70, 220], C: [220, 40, 60]};
const width = 64, height = 64;
const junction = {xMm: 32, yMm: 32};
const sourceOwner = (x: number, y: number): keyof typeof palette =>
  x >= 35 || (x >= 32 && Math.abs(y - 32) <= 2 * (x - 32) / 3) ? 'A' : y < 32 ? 'C' : 'B';

// Independently defined analytic three-material source. The two real corners
// are sqrt(13) pixels from the junction; remote vertical sides are NOT the
// incident tip flanks. The six-square-pixel protrusion belongs to material A.
function source() {
  const rgba = new Uint8Array(width * height * 4), aa = 8;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sum = [0, 0, 0];
    for (let sy = 0; sy < aa; sy++) for (let sx = 0; sx < aa; sx++) {
      const color = palette[sourceOwner(x + (sx + .5) / aa, y + (sy + .5) / aa)];
      for (let c = 0; c < 3; c++) sum[c] += color[c];
    }
    rgba.set([...sum.map(v => Math.round(v / aa ** 2)), 255], (y * width + x) * 4);
  }
  return rgba;
}
function contains(p: XY, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.yMm > p.yMm) !== (b.yMm > p.yMm) && p.xMm < (b.xMm - a.xMm) * (p.yMm - a.yMm) / (b.yMm - a.yMm) + a.xMm) inside = !inside;
  }
  return inside;
}
function boundaryDistance(p: XY, ring: XY[]) {
  return Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], dx = b.xMm - a.xMm, dy = b.yMm - a.yMm;
    const t = Math.max(0, Math.min(1, ((p.xMm - a.xMm) * dx + (p.yMm - a.yMm) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.xMm - a.xMm - t * dx, p.yMm - a.yMm - t * dy);
  }));
}

it('retains the analytic three-material tip and opaque A cores when its remote sides turn vertical', () => {
  const branches = [
    {raw: [point(32, 32, 'j-upper'), point(35, 30, 'upper-corner'), point(35, 2, 'top')], closed: false, colors: ['#f0dc28', '#dc283c']},
    {raw: [point(32, 32, 'j-lower'), point(35, 34, 'lower-corner'), point(35, 62, 'bottom')], closed: false, colors: ['#f0dc28', '#2346dc']},
    {raw: [point(32, 32, 'j-left'), point(2, 32, 'left')], closed: false, colors: ['#2346dc', '#dc283c']},
  ];
  const rgba = source(), original = structuredClone(branches), beforeRGBA = rgba.slice();
  const cores = [{xMm: 34.5, yMm: 31.5}, {xMm: 34.5, yMm: 32.5}];
  for (const core of cores) {
    expect(sourceOwner(core.xMm, core.yMm)).toBe('A');
    const offset = (Math.floor(core.yMm) * width + Math.floor(core.xMm)) * 4;
    expect(Array.from(rgba.slice(offset, offset + 4)), 'each independent probe is an opaque unmixed source pixel').toEqual([...palette.A, 255]);
  }
  const result = sourceJunctions(branches, width, height, rgba);
  // Refusal is a valid safe outcome; no requirement to move this exact source.
  const output = result?.output ?? original.map(branch => branch.raw);
  const materialA = [...output[0], point(64, 2, 'right-top'), point(64, 62, 'right-bottom'), ...[...output[1]].reverse()];
  const metrics = {evidence: result?.evidence ?? [], starts: output.map(arm => arm[0]), tipDistance: boundaryDistance(junction, materialA), coreOwnership: cores.map(core => contains(core, materialA))};
  const message = JSON.stringify(metrics);
  expect(branches, 'input geometry is immutable').toEqual(original);
  expect(rgba, 'source pixels are immutable').toEqual(beforeRGBA);
  for (const arm of output) {
    expect.soft(Math.hypot(arm[0].xMm - output[0][0].xMm, arm[0].yMm - output[0][0].yMm), message).toBeLessThanOrEqual(1e-7);
    expect.soft(arm.every(p => Number.isFinite(p.xMm) && Number.isFinite(p.yMm)), message).toBe(true);
  }
  // Existing independent source-tip suites use the same 1.5 native-pixel
  // source-geometry bound; no precision improvement is demanded here.
  expect.soft(metrics.tipDistance, message).toBeLessThanOrEqual(1.5);
  for (const retained of metrics.coreOwnership) expect.soft(retained, message).toBe(true);
});
