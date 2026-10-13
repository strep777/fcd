import type { IllustrationRegion } from './illustration';
/** Conservative ownership refinement guided by original image edges. Material labels remain a
 * complete partition; only confidently located color or dark silhouette transitions can
 * move. No coordinate averaging, region closing or contour smoothing occurs. */
export function refineImageEdgeOwnership(width: number, height: number, rgba: Uint8Array, regions: IllustrationRegion[]) {
    const size = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || size > 4096 * 4096 || rgba.length !== size * 4)
        throw Error('IMAGE_LIMIT');
    const labels = new Int32Array(size).fill(-1);
    for (const [id, region] of regions.entries()) {
        for (const index of region.indices) {
            if (!Number.isInteger(index) || index < 0 || index >= size || labels[index] >= 0)
                throw Error('INVALID_MASK');
            labels[index] = id;
        }
    }
    // Proposals are collected before labels are changed, so the original
    // ownership can share this buffer instead of copying the entire raster.
    const initial = labels;
    const palette = regions.map(region => {
        const rgb = [1, 3, 5].map(i => parseInt(region.color.slice(i, i + 2), 16));
        const sum = rgb.reduce((a, b) => a + b, 0) || 1;
        return { rgb: rgb.map(v => v / sum), linear: rgb.map(v => v / 255), dark: Math.max(...rgb) < 80, saturation: (Math.max(...rgb) - Math.min(...rgb)) / (Math.max(...rgb) || 1) };
    });
    const exterior = { rgb: [1 / 3, 1 / 3, 1 / 3], linear: [1, 1, 1], dark: false, saturation: 0 };
    const pigment = (owner: number) => owner < 0 ? exterior : palette[owner];
    const targets = new Int32Array(size).fill(-2), scores = new Float32Array(size);
    let supportedEdges = 0;
    function probe(i: number, j: number, stride: number, coordinate: number, limit: number) {
        const a = initial[i], b = initial[j];
        const pa = pigment(a), pb = pigment(b), darkPair = pa.dark !== pb.dark;
        if (a === b || pa.dark && pb.dark || (a < 0 || b < 0) && !darkPair || coordinate < 7 || coordinate + 7 >= limit)
            return;
        const channelsA = darkPair ? pa.linear : pa.rgb, channelsB = darkPair ? pb.linear : pb.rgb;
        const delta = channelsA.map((v, c) => v - channelsB[c]), norm = Math.hypot(...delta);
        if (norm < .015)
            return;
        const dir = delta.map(v => v / norm);
        // Confirm broad support on both sides. A third owner, exterior, an ink
        // separator, or a narrow tip excludes the search corridor entirely.
        for (let t = -6; t <= 7; t++) {
            const owner = initial[i + t * stride];
            if (owner !== a && owner !== b)
                return;
        }
        if (initial[i - 6 * stride] !== a || initial[i + 7 * stride] !== b)
            return;
        if (darkPair) {
            const darkOwner = pa.dark ? a : b, x = i % width, y = Math.floor(i / width);
            let supported = false;
            for (let dy = -4; dy <= 4 && !supported; dy++)
                for (let dx = -4; dx <= 4; dx++) {
                    if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
                        continue;
                    const p = i + dy * width + dx;
                    if (initial[p] === darkOwner && Math.max(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]) < 80) {
                        supported = true;
                        break;
                    }
                }
            if (!supported)
                return;
        }
        // Normalize only the narrow color profiles actually examined. A full
        // three-channel Float32 raster costs 192 MiB at the image size limit.
        const value = (t: number) => {
            const offset = (i + t * stride) * 4;
            const sum = darkPair ? 255 : rgba[offset] + rgba[offset + 1] + rgba[offset + 2] + 1;
            return (dir[0] * rgba[offset] + dir[1] * rgba[offset + 1] + dir[2] * rgba[offset + 2]) / sum;
        };
        const gradient = (t: number) => (value(t - 2) + 2 * value(t - 1) - 2 * value(t + 1) - value(t + 2)) / 8;
        const sideA = darkPair && pa.dark ? dir.reduce((s, d, c) => s + d * pa.linear[c], 0) : value(-6);
        const sideB = darkPair && pb.dark ? dir.reduce((s, d, c) => s + d * pb.linear[c], 0) : value(7);
        const contrast = sideA - sideB;
        let peak = 0, opposite = 0;
        for (let t = -4; t <= 5; t++) {
            const g = gradient(t);
            opposite = Math.max(opposite, -g);
            if (g > peak) {
                peak = g;
            }
        }
        // Keep the existing high-contrast decision unchanged. A softer step
        // must instead rise above measured variation within both source-side
        // plateaus. Fixed color-distance gates alone reject quiet pastel edges.
        if (darkPair && (norm < .12 || contrast < .08 || peak < .025))
            return;
        const highContrast = norm >= .12 && contrast >= .08 && peak >= .025;
        if (!highContrast) {
            const plateauNoise = Math.max(Math.abs(value(-6) - value(-5)), Math.abs(value(6) - value(7)));
            if (contrast < Math.max(.015, plateauNoise * 4) || peak < .004)
                return;
        }
        if (peak < contrast * .10)
            return;
        // A blurred color step can have two nearly equal derivative ridges.
        // Selecting the larger ridge jumps between their sides as JPEG blocks
        // vary. Locate the half-contrast crossing of the original color profile
        // instead; accept only one crossing supported by the two owner sides.
        const level = (sideA + sideB) / 2;
        // An ink line may overshoot the exterior chroma and rebound while
        // remaining wholly on that side of the material step. That is not a
        // second pigment edge. Reject a strong reverse transition only when
        // it reaches the interior side of the independently measured level.
        if (!darkPair && opposite > peak * .5) {
            for (let t = -4; t <= 5; t++) {
                if (gradient(t) < -peak * .5 && Math.max(value(t - 1), value(t), value(t + 1)) >= level)
                    return;
            }
        }
        const crossings: number[] = [];
        for (let t = -4; t < 5; t++) {
            const left = value(t), right = value(t + 1);
            if (left >= level && right < level)
                crossings.push(t + .5 + (left - level) / (left - right));
        }
        let recrosses = false;
        for (let t = -4; t < 5; t++)
            if (value(t) < level && value(t + 1) >= level)
                recrosses = true;
        if (crossings.length !== 1 || !darkPair && recrosses)
            return;
        const edge = crossings[0], original = 1;
        if (Math.abs(edge - original) > 4.5)
            return;
        supportedEdges++;
        for (let t = -4; t <= 5; t++) {
            const p = i + t * stride, target = t + .5 < edge ? a : b;
            // Exterior correction is removal-only. Independent source pixels
            // can disprove a pale claw halo without inventing foreground.
            if (initial[p] < 0)
                continue;
            if (initial[p] === target)
                continue;
            if (peak > scores[p]) {
                scores[p] = peak;
                targets[p] = target;
            }
        }
    }
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (x + 1 < width && initial[i] !== initial[i + 1])
                probe(i, i + 1, 1, x, width);
            if (y + 1 < height && initial[i] !== initial[i + width])
                probe(i, i + width, width, y, height);
        }
    const offsets = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    function localComponents(i: number, owner: number, equal: boolean, eight: boolean) {
        const active = offsets.map(([dx, dy]) => (labels[i + dy * width + dx] === owner) === equal), seen = new Set<number>();
        let count = 0;
        for (let a = 0; a < 8; a++) {
            if (!active[a] || seen.has(a))
                continue;
            count++;
            const queue = [a];
            seen.add(a);
            for (let q = 0; q < queue.length; q++) {
                const p = queue[q];
                for (let b = 0; b < 8; b++) {
                    const dx = Math.abs(offsets[p][0] - offsets[b][0]), dy = Math.abs(offsets[p][1] - offsets[b][1]);
                    if (active[b] && !seen.has(b) && (eight ? Math.max(dx, dy) === 1 : dx + dy === 1)) {
                        seen.add(b);
                        queue.push(b);
                    }
                }
            }
        }
        return count;
    }
    const proposals: number[] = [];
    for (let i = 0; i < size; i++)
        if (targets[i] !== -2)
            proposals.push(i);
    proposals.sort((a, b) => scores[b] - scores[a]);
    let movedPixels = 0, removedForegroundPixels = 0;
    for (let pass = 0; pass < 5; pass++) {
        let changed = 0;
        for (const i of proposals) {
            const a = labels[i], b = targets[i];
            if (a === b)
                continue;
            const x = i % width, y = Math.floor(i / width);
            if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1)
                continue;
            // Strong chromatic evidence at the pixel itself takes precedence
            // over a blurred neighboring edge profile. This protects warm
            // painted shadows whose saturation is lower than the interior.
            const offset = i * 4;
            const sum = rgba[offset] + rgba[offset + 1] + rgba[offset + 2] + 1;
            const pa = pigment(a), pb = pigment(b), darkPair = pa.dark !== pb.dark;
            if (pa.dark && Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]) < 80)
                continue;
            const colorDistance = (owner: number) => Math.hypot(...pigment(owner).rgb.map((value, channel) => value - rgba[offset + channel] / sum));
            if (!darkPair && colorDistance(a) + .02 < colorDistance(b))
                continue;
            const pixel = [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
            const saturation = (Math.max(...pixel) - Math.min(...pixel)) / (Math.max(...pixel) || 1);
            if (!darkPair && pa.saturation > .3 && pb.saturation < .12 && saturation > .35) {
                const observed = pixel.map(value => value / sum - 1 / 3);
                const chromaticPigment = pa.rgb.map(value => value - 1 / 3);
                const alignment = observed.reduce((value, component, channel) => value + component * chromaticPigment[channel], 0) / (Math.hypot(...observed) * Math.hypot(...chromaticPigment));
                if (alignment > .8)
                    continue;
            }
            // Four-connected regions and eight-connected complements must both retain
            // one local component. These simple-point tests preserve holes, components
            // and junctions throughout sequential ownership changes.
            const meetsAnotherOwner = offsets.some(([dx, dy]) => {
                const owner = labels[i + dy * width + dx];
                return owner !== a && owner !== b;
            });
            if (meetsAnotherOwner)
                continue;
            if (![i - 1, i + 1, i - width, i + width].some(n => labels[n] === b))
                continue;
            if (localComponents(i, a, true, false) !== 1 || localComponents(i, a, false, true) !== 1 || localComponents(i, b, true, false) !== 1 || localComponents(i, b, false, true) !== 1)
                continue;
            labels[i] = b;
            if (b < 0)
                removedForegroundPixels++;
            changed++;
            movedPixels++;
        }
        if (!changed)
            break;
    }
    const indices = regions.map(() => [] as number[]);
    for (let i = 0; i < size; i++)
        if (labels[i] >= 0)
            indices[labels[i]].push(i);
    return {
        regions: regions.map((region, id) => ({ ...region, indices: indices[id] })),
        labels,
        report: { supportedEdges, movedPixels, removedForegroundPixels }
    };
}
