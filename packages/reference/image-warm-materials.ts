type MaterialWindow = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    components: number;
};
export type WarmMaterialBudget = {
    nodes?: number;
    operations?: number;
};
export type WarmMaterialReport = Partial<MaterialWindow> & {
    moved: number;
    skipped?: 'image-border' | 'component-border' | 'image-window-budget' | 'domain-budget' | 'pink-seeds' | 'neutral-seeds' | 'ambiguous-colors' | 'image-budget' | 'graph-budget' | 'local-edge-only';
    pixels?: number;
    operations?: number;
    depth?: number;
    strong?: number;
    neutral?: number;
    supported?: number;
    glints?: number;
    pinkQ?: number;
    grayQ?: number;
};
export type WarmMaterialResult = {
    labels: Int8Array<ArrayBuffer>;
    reports: WarmMaterialReport[];
    moved: number;
};
import { minimumSTCut, type CutArc } from './minimum-cut';
/** Two seeded material hypotheses compete on original color and
 * original RGB edges. Instance identities and old material topology are not
 * constraints; reliable pigment interiors and other materials remain fixed. */
export function refineWarmMaterialLabels(width: number, height: number, rgba: Uint8Array, foreground: Uint8Array, old: Int8Array, saturation: Float32Array, value: Float32Array, budget: WarmMaterialBudget = {}): WarmMaterialResult {
    const size = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || size > 4096 * 4096 || rgba.length !== size * 4 || [foreground, old, saturation, value].some(a => a.length !== size))
        throw Error('IMAGE_LIMIT');
    for (let i = 0; i < size; i++)
        if (!Number.isFinite(saturation[i]) || !Number.isFinite(value[i]) || saturation[i] < 0 || saturation[i] > 1 || value[i] < 0 || value[i] > 1 || foreground[i] > 1 || old[i] < -1 || old[i] > 6)
            throw Error('INVALID_MATERIAL_INPUT');
    const nodeLimit = budget.nodes ?? 262144, operationLimit = budget.operations ?? 60000000;
    if (!Number.isInteger(nodeLimit) || nodeLimit < 0 || nodeLimit > 262144 || !Number.isInteger(operationLimit) || operationLimit < 0 || operationLimit > 60000000)
        throw Error('INVALID_BUDGET');
    const labels = old.slice(), reports: WarmMaterialReport[] = [], windows: MaterialWindow[] = [];
    if (width <= 2 || height <= 2)
        return { labels, reports: [{ skipped: 'image-border', moved: 0 }], moved: 0 };
    let usedNodes = 0, usedOperations = 0;
    const q = (i: number) => { const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2]; return (2 * r - g - b) / (r + g + b + 1); };
    // A typed component queue avoids materializing all components before the
    // candidate-window budget can stop a pathological fragmented image.
    const seen = new Uint8Array(size), componentQueue = new Uint32Array(size);
    for (let start = 0; start < size; start++) {
        if (seen[start] || !foreground[start] || old[start] !== 1)
            continue;
        let head = 0, tail = 1, strongCount = 0, weakCount = 0, minX = width, minY = height, maxX = 0, maxY = 0;
        componentQueue[0] = start;
        seen[start] = 1;
        while (head < tail) {
            const i = componentQueue[head++], x = i % width, y = Math.floor(i / width);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            if (saturation[i] >= .32 && q(i) >= .2 && value[i] > .28)
                strongCount++;
            if (q(i) < .18)
                weakCount++;
            for (const j of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1])
                if (j >= 0 && !seen[j] && foreground[j] && old[j] === 1) {
                    seen[j] = 1;
                    componentQueue[tail++] = j;
                }
        }
        if (strongCount < Math.max(8, tail * .03) || weakCount < 16)
            continue;
        if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1) {
            // Overlapping neighborhoods must respect this whole-component
            // exclusion, not only the window that this component would form.
            for (let i = 0; i < tail; i++)
                seen[componentQueue[i]] = 2;
            reports.push({ minX, minY, maxX, maxY, skipped: 'component-border', moved: 0 });
            continue;
        }
        minX = Math.max(1, minX - 8);
        maxX = Math.min(width - 2, maxX + 8);
        minY = Math.max(1, minY - 8);
        maxY = Math.min(height - 2, maxY + 8);
        windows.push({ minX, minY, maxX, maxY, components: 1 });
        if (windows.length > 256)
            return { labels: old.slice(), reports: [{ skipped: 'image-window-budget', moved: 0 }], moved: 0 };
    }
    // Solve overlapping neighborhoods together from immutable source labels.
    // Repeat after a merge because its enclosing rectangle can reach a third
    // neighborhood. The remaining domains are disjoint, so solve order cannot
    // overwrite a previous material decision.
    let comparisons = 0;
    for (let changed = true; changed;) {
        changed = false;
        outer: for (let i = 0; i < windows.length; i++)
            for (let j = i + 1; j < windows.length; j++) {
                if (++comparisons > 100000)
                    return { labels: old.slice(), reports: [{ skipped: 'image-window-budget', moved: 0 }], moved: 0 };
                const a = windows[i], b = windows[j];
                if (a.minX > b.maxX || b.minX > a.maxX || a.minY > b.maxY || b.minY > a.maxY)
                    continue;
                windows[i] = { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY), components: a.components + b.components };
                windows.splice(j, 1);
                changed = true;
                break outer;
            }
    }
    windows.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
    for (const window of windows) {
        const { minX, maxX, minY, maxY } = window;
        if ((maxX - minX + 1) * (maxY - minY + 1) > 65536) {
            reports.push({ ...window, skipped: 'domain-budget', moved: 0 });
            continue;
        }
        const pixels: number[] = [], neutral: number[] = [];
        for (let y = minY; y <= maxY; y++)
            for (let x = minX; x <= maxX; x++) {
                const i = y * width + x;
                if (!foreground[i] || seen[i] === 2 || old[i] !== 0 && old[i] !== 1)
                    continue;
                pixels.push(i);
                if (old[i] === 0 && (saturation[i] < .12 || q(i) < .06) && value[i] > .28)
                    neutral.push(i);
            }
        const strong = pixels.filter(i => old[i] === 1 && saturation[i] >= .32 && q(i) >= .2 && value[i] > .28);
        if (strong.length < 8) {
            reports.push({ ...window, skipped: 'pink-seeds', moved: 0 });
            continue;
        }
        if (neutral.length < 16) {
            reports.push({ ...window, skipped: 'neutral-seeds', moved: 0 });
            continue;
        }
        const median = (a: number[]) => a.sort((a, b) => a - b)[a.length >> 1], pinkQ = median(strong.map(q)), grayQ = median(neutral.map(q)), gap = pinkQ - grayQ;
        if (gap < .12) {
            reports.push({ ...window, skipped: 'ambiguous-colors', moved: 0 });
            continue;
        }
        const index = new Map(pixels.map((i, n) => [i, n])), n = pixels.length, source = n, sink = n + 1;
        if (usedNodes + n > nodeLimit || usedOperations >= operationLimit) {
            reports.push({ ...window, skipped: 'image-budget', moved: 0 });
            continue;
        }
        usedNodes += n;
        const strongSet = new Set(strong), neutralSet = new Set(neutral);
        const light = (i: number) => (rgba[4 * i] + rgba[4 * i + 1] + rgba[4 * i + 2]) / 3;
        const blocked = new Set<number>();
        for (const i of pixels) {
            if (old[i] !== 1)
                continue;
            const x = i % width, y = Math.floor(i / width);
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
                const ax = x + dx * 2, ay = y + dy * 2, bx = x - dx * 2, by = y - dy * 2;
                if (ax < 0 || ax >= width || bx < 0 || bx >= width || ay < 0 || ay >= height || by < 0 || by >= height)
                    continue;
                if (light(i) + 20 < Math.min(light(ay * width + ax), light(by * width + bx))) {
                    blocked.add(i);
                    break;
                }
            }
        }
        const pigmentReach = new Set(strong.filter(i => value[i] > .6 && !blocked.has(i))), pigmentQueue = Array.from(pigmentReach);
        for (let p = 0; p < pigmentQueue.length; p++) {
            const i = pigmentQueue[p], x = i % width, y = Math.floor(i / width);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const xx = x + dx, yy = y + dy;
                if (xx < minX || xx > maxX || yy < minY || yy > maxY)
                    continue;
                const j = yy * width + xx;
                if (old[j] === 1 && foreground[j] && !blocked.has(j) && !pigmentReach.has(j)) {
                    pigmentReach.add(j);
                    pigmentQueue.push(j);
                }
            }
        }
        // A visible source color step at an existing material boundary is evidence
        // for that boundary, even when the connected pigment is much paler than its
        // strongest interior. Such evidence protects narrow tips and light strips.
        const supported = new Set<number>();
        const noise = (i: number, dx: number, dy: number) => {
            const rgb: number[] = [], red: number[] = [], x = i % width, y = Math.floor(i / width);
            for (let t = -2; t <= 2; t++) {
                if (!t)
                    continue;
                const xx = x - dy * t, yy = y + dx * t;
                if (xx < 0 || xx >= width || yy < 0 || yy >= height)
                    continue;
                const j = yy * width + xx;
                if (!foreground[j] || old[j] !== old[i])
                    continue;
                rgb.push(Math.hypot(...[0, 1, 2].map(c => rgba[4 * i + c] - rgba[4 * j + c])));
                red.push(Math.abs(q(i) - q(j)));
            }
            if (rgb.length < 2)
                return { rgb: Infinity, red: Infinity };
            rgb.sort((a, b) => a - b);
            red.sort((a, b) => a - b);
            return { rgb: rgb[(rgb.length - 1) >> 1], red: red[(red.length - 1) >> 1] };
        };
        for (const i of pixels) {
            if (old[i] !== 1 || !pigmentReach.has(i))
                continue;
            const x = i % width, y = Math.floor(i / width);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || xx >= width || yy < 0 || yy >= height)
                    continue;
                const k = yy * width + xx;
                if (!foreground[k] || old[k] !== 0)
                    continue;
                const a = noise(i, dx, dy), b = noise(k, dx, dy);
                if (q(i) - q(k) > Math.max(.015, 4 * Math.max(a.red, b.red)) && Math.hypot(...[0, 1, 2].map(c => rgba[4 * i + c] - rgba[4 * k + c])) > Math.max(6, 4 * Math.max(a.rgb, b.rgb)))
                    supported.add(i);
            }
        }
        // Compact bright highlights can touch a white separator after antialiasing.
        // Opposed nearby pink samples in the source, with the bright point above
        // both samples, distinguish these highlights from a broad white fur field.
        const glints = new Set<number>();
        const bright = new Set(pixels.filter(i => old[i] === 1 && value[i] >= .94 && saturation[i] <= .16 && q(i) <= .12)), compact = new Set<number>();
        while (bright.size) {
            const start = bright.values().next().value!, group = [start];
            bright.delete(start);
            let minBrightX = width, minBrightY = height, maxBrightX = 0, maxBrightY = 0;
            for (let p = 0; p < group.length; p++) {
                const i = group[p], x = i % width, y = Math.floor(i / width);
                minBrightX = Math.min(minBrightX, x);
                maxBrightX = Math.max(maxBrightX, x);
                minBrightY = Math.min(minBrightY, y);
                maxBrightY = Math.max(maxBrightY, y);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || xx >= width || yy < 0 || yy >= height)
                        continue;
                    const j = yy * width + xx;
                    if (bright.delete(j))
                        group.push(j);
                }
            }
            // The four-pixel evidence neighborhood must contain a compact bright spot,
            // rather than a longer white fur tongue whose two sides happen to be pink.
            if (maxBrightX - minBrightX < 8 && maxBrightY - minBrightY < 8 && group.length <= 32)
                for (const i of group)
                    compact.add(i);
        }
        for (const i of compact) {
            const x = i % width, y = Math.floor(i / width), light = (rgba[4 * i] + rgba[4 * i + 1] + rgba[4 * i + 2]) / 3;
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
                let sides = 0;
                for (const sign of [-1, 1])
                    for (let distance = 2; distance <= 4; distance++) {
                        const xx = x + dx * distance * sign, yy = y + dy * distance * sign;
                        if (xx < 0 || xx >= width || yy < 0 || yy >= height)
                            break;
                        const k = yy * width + xx;
                        if (foreground[k] && old[k] === 1 && q(k) >= .16 && saturation[k] >= .22 && value[k] >= .4 && (rgba[4 * k] + rgba[4 * k + 1] + rgba[4 * k + 2]) / 3 < light - 25) {
                            sides++;
                            break;
                        }
                    }
                if (sides === 2) {
                    glints.add(i);
                    break;
                }
            }
        }
        function* arcs(): Generator<CutArc> {
            for (const [j, i] of pixels.entries()) {
                const red = q(i), dp = 4 * ((red - pinkQ) / gap) ** 2, dn = 4 * ((red - grayQ) / gap) ** 2;
                const fixed = strongSet.has(i) || supported.has(i) || glints.has(i);
                yield { from: source, to: j, capacity: neutralSet.has(i) ? 0 : fixed ? 1e8 : dn };
                yield { from: j, to: sink, capacity: fixed ? 0 : neutralSet.has(i) ? 1e8 : dp };
                for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
                    const x = i % width + dx, y = Math.floor(i / width) + dy;
                    if (x < 0 || x >= width || y < 0 || y >= height)
                        continue;
                    const k = index.get(y * width + x);
                    if (k === undefined)
                        continue;
                    const other = pixels[k], distance = dx && dy ? Math.SQRT2 : 1, diff = Math.hypot(...[0, 1, 2].map(c => rgba[4 * i + c] - rgba[4 * other + c])), coupling = 8 * (.02 + Math.exp(-(diff * diff) / (2 * 24 * 24))) / distance;
                    yield { from: j, to: k, capacity: coupling };
                    yield { from: k, to: j, capacity: coupling };
                }
            }
        }
        const cut = minimumSTCut(n + 2, arcs(), source, sink, operationLimit - usedOperations);
        usedOperations += cut.operations;
        if (!cut.converged || !cut.side) {
            reports.push({ ...window, pixels: n, operations: cut.operations, skipped: 'graph-budget', moved: 0 });
            continue;
        }
        const inside = cut.side;
        // A recovered white glint is not an independent neutral-material seed.
        // Do not invent an enclosed gray island from brightness alone: new neutral
        // support must remain connected to a trusted old neutral interior.
        const neutralReach = new Uint8Array(n), neutralQueue = neutral.map(i => index.get(i)!);
        for (const j of neutralQueue)
            neutralReach[j] = 1;
        for (let k = 0; k < neutralQueue.length; k++)
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const i = pixels[neutralQueue[k]], x = i % width + dx, y = Math.floor(i / width) + dy;
                if (x < 0 || x >= width || y < 0 || y >= height)
                    continue;
                const j = index.get(y * width + x);
                if (j !== undefined && !inside[j] && !neutralReach[j]) {
                    neutralReach[j] = 1;
                    neutralQueue.push(j);
                }
            }
        // This stage corrects gross material regions beyond the existing 4.5-pixel
        // local edge corridor. Do not apply a global palette decision when its only
        // disagreement is antialiasing or a small shaded border. Distance traverses
        // the full window, including other labels, so a nearby neutral sample can
        // never appear farther away merely because another pigment blocks a path.
        let depth = 0;
        const spanWidth = maxX - minX + 1, spanHeight = maxY - minY + 1, distance = new Int32Array(spanWidth * spanHeight).fill(-1), distanceQueue: number[] = [];
        for (let y = minY; y <= maxY; y++)
            for (let x = minX; x <= maxX; x++) {
                const i = y * width + x, k = (y - minY) * spanWidth + x - minX;
                if (foreground[i] && old[i] === 0) {
                    distance[k] = 0;
                    distanceQueue.push(k);
                }
            }
        for (let p = 0; p < distanceQueue.length; p++) {
            const j = distanceQueue[p], x = j % spanWidth, y = Math.floor(j / spanWidth);
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || xx >= spanWidth || yy < 0 || yy >= spanHeight)
                    continue;
                const k = yy * spanWidth + xx;
                if (distance[k] < 0) {
                    distance[k] = distance[j] + 1;
                    distanceQueue.push(k);
                }
            }
        }
        for (const [j, i] of pixels.entries())
            if (old[i] === 1 && !inside[j] && neutralReach[j])
                depth = Math.max(depth, distance[(Math.floor(i / width) - minY) * spanWidth + i % width - minX]);
        if (depth < 5) {
            reports.push({ ...window, pixels: n, depth, operations: cut.operations, skipped: 'local-edge-only', moved: 0 });
            continue;
        }
        let moved = 0;
        for (const [j, i] of pixels.entries()) {
            const next = inside[j] || !neutralReach[j] ? 1 : 0;
            if (labels[i] !== next) {
                labels[i] = next;
                moved++;
            }
        }
        reports.push({ ...window, strong: strong.length, neutral: neutral.length, supported: supported.size, glints: glints.size, depth, pixels: pixels.length, pinkQ, grayQ, operations: cut.operations, moved });
    }
    return { labels, reports, moved: labels.reduce((s, v, i) => s + (v !== old[i] ? 1 : 0), 0) };
}
