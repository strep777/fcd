import{expect,it}from'vitest';
import{sourceJunctions}from'../../packages/reference/image-tip-junctions';
import{point,palette,width,height,junction,sourceOwner,source,contains,boundaryDistance,observed}from'../fixtures/junction-short-core-source';

it.each(['offset3','noise3','shadow'] as const)('retains the same short analytic material under %s source observation', mode => {
  const branches = [
    {raw: [point(32, 32, 'j-upper'), point(35, 30, 'upper-corner'), point(35, 2, 'top')], closed: false, colors: ['#f0dc28', '#dc283c']},
    {raw: [point(32, 32, 'j-lower'), point(35, 34, 'lower-corner'), point(35, 62, 'bottom')], closed: false, colors: ['#f0dc28', '#2346dc']},
    {raw: [point(32, 32, 'j-left'), point(2, 32, 'left')], closed: false, colors: ['#2346dc', '#dc283c']},
  ];
  const rgba = source(mode), original = structuredClone(branches), beforeRGBA = rgba.slice();
  const cores = [{xMm: 34.5, yMm: 31.5}, {xMm: 34.5, yMm: 32.5}];
  for (const core of cores) {
    expect(sourceOwner(core.xMm, core.yMm)).toBe('A');
    const offset = (Math.floor(core.yMm) * width + Math.floor(core.xMm)) * 4;
    expect(Array.from(rgba.slice(offset, offset + 4)), 'each independent probe is an opaque unmixed source pixel').toEqual([...observed(palette.A,Math.floor(core.xMm),Math.floor(core.yMm),mode),255]);
  }
  const result = sourceJunctions(branches, width, height, rgba);
  // Refusal is a valid safe outcome; no requirement to move this exact source.
  const output = result?.output ?? original.map(branch => branch.raw);
  const materialA = [...output[0], point(64, 2, 'right-top'), point(64, 62, 'right-bottom'), ...[...output[1]].reverse()];
  const metrics = {evidence: result?.evidence ?? [], starts: output.map(arm => arm[0]), tipDistance: boundaryDistance(junction, materialA), coreOwnership: cores.map(core => contains(core, materialA))};
  const message = JSON.stringify({mode,...metrics});
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

