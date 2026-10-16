import sharp from 'sharp';

export const width = 96, height = 80;
export const blue = [35, 100, 230], yellow = [245, 220, 50], white = [246, 246, 242];
export type Fixture = { kind: 'line' | 'hole'; size: number; blur: number };
export const ambiguousCompact: Fixture[] = [
  ...[1, 2].flatMap(size => [.6, 1.5, 3].map(blur => ({ kind: 'hole' as const, size, blur }))),
  ...[1.5, 3].map(blur => ({ kind: 'hole' as const, size: 4, blur })),
];
export const nameOf = (s: Fixture) => `true-white-${s.kind}-${s.size}px-blur${s.blur}`;

// These are two forward models, not two semantic labels passed to extraction.
// The reflection model has only blue/yellow material. Its bounded local light
// field reaches 1 on the compact square. This is an admissible ambiguity
// construction; it is not proof that actual photographed lighting does this.
export function sampledSource(s: Fixture, interpretation: 'paint' | 'reflection') {
  const aa = 6, source = new Uint8Array(width * height * 4);
  if (interpretation === 'reflection' && s.kind !== 'hole') throw Error('COMPACT_REFLECTION_ONLY');
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sum = [0, 0, 0];
    for (let j = 0; j < aa; j++) for (let i = 0; i < aa; i++) {
      const px = x + (i + .5) / aa, py = y + (j + .5) / aa;
      const inset = s.kind === 'hole' && px >= 20 && px < 20 + s.size && py >= 36 && py < 36 + s.size;
      let value: number[];
      if (interpretation === 'reflection') {
        const base = px < 48.3 ? blue : yellow;
        const reflection = inset ? 1 : 0;
        value = base.map((v, c) => v + reflection * (white[c] - v));
      } else {
        value = s.kind === 'line'
          ? px < 48 ? blue : px < 48 + s.size ? white : yellow
          : inset ? white : px < 48.3 ? blue : yellow;
      }
      for (let c = 0; c < 3; c++) sum[c] += value[c] / (aa * aa);
    }
    source.set([...sum.map(Math.round), 255], (y * width + x) * 4);
  }
  return source;
}

export async function observedSource(s: Fixture, interpretation: 'paint' | 'reflection') {
  const source = sampledSource(s, interpretation);
  const blurred = await sharp(source, { raw: { width, height, channels: 4 } })
    .blur({ sigma: s.blur, precision: 'float' }).raw({ depth: 'float' }).toBuffer();
  return Uint8Array.from({ length: source.length }, (_, i) => Math.round(Math.max(0, Math.min(255, blurred.readFloatLE(i * 4)))));
}

// Existing two-round 8-bit quantization bound, not a visibility/material cutoff.
export const roundingBudget = Math.sqrt(3) + 1e-6;
export function offTwoColor(rgb: ArrayLike<number>) {
  const delta = yellow.map((v, c) => v - blue[c]);
  const t = Math.max(0, Math.min(1, delta.reduce((s, v, c) => s + v * (rgb[c] - blue[c]), 0) / delta.reduce((s, v) => s + v * v, 0)));
  return Math.hypot(...blue.map((v, c) => rgb[c] - v - t * delta[c]));
}

export function sourceRibbon(rgba: Uint8Array) {
  return Array.from({ length: width * height }, (_, i) => i)
    .filter(i => rgba[i * 4 + 3] === 255 && offTwoColor(rgba.subarray(i * 4, i * 4 + 3)) > roundingBudget);
}
