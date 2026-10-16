import type { Point, Piece } from '../schema/index';
import { boxIndex, type Box } from '../surface/spatial';
type Curve = NonNullable<Piece['curves']>[number];
type Grid = {
    size: number;
    ux: number;
    uy: number;
};
type Arc = {
    a: Point;
    b: Point;
    c1: Point;
    c2: Point;
};
export type JointRefitOptions = {
    grid: Grid;
    protectedIds: ReadonlySet<string>;
    bevel: (raw: Point) => boolean;
    createId: () => string;
    tools: {
        flatten: (a: Point, c1: Point, c2: Point, b: Point, tolerance: number, createId: () => string) => Point[];
        spanError: (source: Point[], target: Point[], pixel: number, spacing: number) => number;
        straight: (source: Point[], grid: Grid) => unknown;
    };
};
const length = (a: Point, b: Point) => Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
const distance = (p: Point, a: Point, b: Point) => { const x = b.xMm - a.xMm, y = b.yMm - a.yMm, d = x * x + y * y, t = d ? Math.max(0, Math.min(1, ((p.xMm - a.xMm) * x + (p.yMm - a.yMm) * y) / d)) : 0; return Math.hypot(p.xMm - a.xMm - t * x, p.yMm - a.yMm - t * y); };
const basis = (t: number) => { const s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; };
const sampleCount = (distance: number, step: number) => Math.max(1, Math.ceil(distance / step - 1e-9));
function solve(matrix: number[][], value: number[]) {
    const rows = matrix.map((r, i) => [...r, value[i]]), n = rows.length;
    for (let i = 0; i < n; i++) {
        let pivot = i;
        for (let j = i + 1; j < n; j++)
            if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i]))
                pivot = j;
        if (Math.abs(rows[pivot][i]) < 1e-12)
            return;
        [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
        const d = rows[i][i];
        for (let k = i; k <= n; k++)
            rows[i][k] /= d;
        for (let j = 0; j < n; j++)
            if (j !== i) {
                const v = rows[j][i];
                for (let k = i; k <= n; k++)
                    rows[j][k] -= v * rows[i][k];
            }
    }
    const result = rows.map(r => r[n]);
    return result.every(Number.isFinite) ? result : undefined;
}
function residualData(points: Point[]) {
    const boxes: Box[] = points.slice(0, -1).map((p, i) => [Math.min(p.xMm, points[i + 1].xMm), Math.min(p.yMm, points[i + 1].yMm), Math.max(p.xMm, points[i + 1].xMm), Math.max(p.yMm, points[i + 1].yMm)]), index = boxIndex(boxes), samples: {
        point: Point;
        weight: number;
    }[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
        const d = length(points[i], points[i + 1]), n = sampleCount(d, .4);
        if (samples.length + n > 384)
            return;
        for (let k = 0; k < n; k++) {
            const t = (k + .5) / n;
            samples.push({ point: { id: '', xMm: points[i].xMm + t * (points[i + 1].xMm - points[i].xMm), yMm: points[i].yMm + t * (points[i + 1].yMm - points[i].yMm) }, weight: d / n });
        }
    }
    return { points, index, samples };
}
function residual(source: NonNullable<ReturnType<typeof residualData>>, targetPoints: Point[]) {
    const target = residualData(targetPoints);
    if (!target)
        return;
    function integral(a: typeof source, b: typeof source) { let sum = 0, arc = 0; for (const { point: p, weight } of a.samples) {
        let v = Infinity;
        for (const j of b.index.query([p.xMm - 1.05, p.yMm - 1.05, p.xMm + 1.05, p.yMm + 1.05]))
            v = Math.min(v, distance(p, b.points[j], b.points[j + 1]));
        sum += v * v * weight;
        arc += weight;
    } return { sum, arc }; }
    const a = integral(source, target), b = integral(target, source);
    if (a.arc + b.arc <= 0)
        return;
    const value = Math.sqrt((a.sum + b.sum) / (a.arc + b.arc));
    return Number.isFinite(value) ? value : undefined;
}
/** Preserve the existing short-span direction contract. Original measurements
 * determine monotonicity; the actual candidate anchors determine derivatives. */
function supportedDirection(raw: Point[], arc: Arc, grid: Grid) {
    if (raw.slice(1).reduce((s, p, i) => s + length(raw[i], p), 0) > 12 + 1e-7)
        return true;
    const origin = raw[0];
    for (const [x, y] of [[grid.ux, grid.uy], [-grid.uy, grid.ux]]) {
        const coordinate = (p: Point) => (p.xMm - origin.xMm) * x + (p.yMm - origin.yMm) * y, values = raw.map(coordinate), advance = values.at(-1)!;
        if (Math.abs(advance) + 1e-7 < 4)
            continue;
        const sign = Math.sign(advance);
        if (values.some((v, i) => i && sign * (v - values[i - 1]) < -1e-7))
            continue;
        const p = sign * (coordinate(arc.c1) - coordinate(arc.a)), q = sign * (coordinate(arc.c2) - coordinate(arc.c1)), r = sign * (coordinate(arc.b) - coordinate(arc.c2)), quadratic = p - 2 * q + r, t = quadratic > 0 ? (p - q) / quadratic : -1;
        if (Math.min(p, r, t > 0 && t < 1 ? p + 2 * (q - p) * t + quadratic * t * t : Infinity) < -1e-7)
            return false;
    }
    return true;
}
/** Fit the existing two source spans jointly. Outer endpoints and controls are
 * immutable; only the two inner controls and the measured source knot move.
 * Acceptance uses data error and native contracts, never join angles or C1. */
export function refitMeasuredCubicWindow(raw: Point[], baseline: {
    nodes: Point[];
    curves: Curve[];
}, options: JointRefitOptions) {
    const pixel = options.grid.size, finite = (p: Point) => Number.isFinite(p.xMm) && Number.isFinite(p.yMm);
    if (!Number.isFinite(pixel) || pixel <= 0 || raw.length < 5 || raw.length > 64 || baseline.nodes.length !== 3 || baseline.curves.length < 1 || baseline.curves.length > 2)
        return;
    if (!raw.every(finite) || !baseline.nodes.every(finite) || baseline.curves.some(c => !finite(c.c1) || !finite(c.c2)))
        return;
    if (raw.slice(1, -1).some(p => options.protectedIds.has(p.id) || options.bevel(p)))
        return;
    const [worldA, worldK, worldB] = baseline.nodes, split = raw.findIndex(p => p.id === worldK.id);
    if (split <= 0 || split + 1 >= raw.length || raw[0].id !== worldA.id || raw.at(-1)!.id !== worldB.id)
        return;
    const origin = raw[0], local = (p: Point) => ({ ...p, xMm: (p.xMm - origin.xMm) / pixel, yMm: (p.yMm - origin.yMm) / pixel }), source = raw.map(local), grid = { ...options.grid, size: 1 }, nodes = baseline.nodes.map(local);
    if (options.tools.straight(source, grid))
        return;
    const existing = [baseline.curves.find(c => c.startNodeId === worldA.id && c.endNodeId === worldK.id), baseline.curves.find(c => c.startNodeId === worldK.id && c.endNodeId === worldB.id)];
    if (existing.filter(Boolean).length !== baseline.curves.length)
        return;
    const arcs: Arc[] = existing.map((c, i) => { const a = nodes[i], b = nodes[i + 1]; return { a, b, c1: c ? local(c.c1) : { id: '', xMm: a.xMm + (b.xMm - a.xMm) / 3, yMm: a.yMm + (b.yMm - a.yMm) / 3 }, c2: c ? local(c.c2) : { id: '', xMm: a.xMm + 2 * (b.xMm - a.xMm) / 3, yMm: a.yMm + 2 * (b.yMm - a.yMm) / 3 } }; });
    if (arcs.some((c, i) => !existing[i] && length(c.a, c.b) > 6 + 1e-7))
        return;
    let count = 2;
    for (let i = 0; i + 1 < source.length; i++)
        count += sampleCount(length(source[i], source[i + 1]), .5);
    if (count > 384)
        return;
    const sample = (span: Point[]) => span.flatMap((p, i) => i + 1 === span.length ? [p] : Array.from({ length: sampleCount(length(p, span[i + 1]), .5) }, (_, j) => { const n = sampleCount(length(p, span[i + 1]), .5), t = j / n; return { id: '', xMm: p.xMm + t * (span[i + 1].xMm - p.xMm), yMm: p.yMm + t * (span[i + 1].yMm - p.yMm) }; }));
    const spans = [sample(source.slice(0, split + 1)), sample(source.slice(split))], arcLengths = spans.map(span => { const a = [0]; for (let i = 1; i < span.length; i++)
        a.push(a.at(-1)! + length(span[i - 1], span[i])); return a; }), parameters = arcLengths.map(a => a.map(v => v / a.at(-1)!));
    if (parameters.some(a => a.some(v => !Number.isFinite(v))))
        return;
    const flatten = (arc: Arc) => options.tools.flatten(arc.a, arc.c1, arc.c2, arc.b, .01, options.createId), join = (first: Point[], second: Point[]) => [...first, ...second.slice(1)];
    let before: Point[];
    try {
        before = join(existing[0] ? flatten(arcs[0]) : [arcs[0].a, arcs[0].b], existing[1] ? flatten(arcs[1]) : [arcs[1].a, arcs[1].b]);
    }
    catch {
        return;
    }
    if (before.length > 4000)
        return;
    const sourceMetric = residualData(source);
    if (!sourceMetric)
        return;
    const beforeRms = residual(sourceMetric, before);
    if (beforeRms === undefined)
        return;
    let best: {
        arcs: Arc[];
        rms: number;
        error: number;
    } | undefined;
    for (let round = 0; round < 12; round++) {
        const matrix = Array.from({ length: 3 }, () => new Array(3).fill(0)), rhsX = new Array(3).fill(0), rhsY = new Array(3).fill(0);
        for (let side = 0; side < 2; side++)
            for (let i = 0; i < spans[side].length; i++) {
                const B = basis(parameters[side][i]), row = side ? [0, B[0], B[1]] : [B[2], B[3], 0], known = side ? [arcs[1].c2, arcs[1].b] : [arcs[0].a, arcs[0].c1], coefficients = side ? [B[2], B[3]] : [B[0], B[1]], p = spans[side][i], rx = p.xMm - coefficients[0] * known[0].xMm - coefficients[1] * known[1].xMm, ry = p.yMm - coefficients[0] * known[0].yMm - coefficients[1] * known[1].yMm, a = arcLengths[side], weight = ((a[i + 1] ?? a[i]) - (a[i - 1] ?? a[i])) / 2;
                for (let j = 0; j < 3; j++) {
                    rhsX[j] += weight * row[j] * rx;
                    rhsY[j] += weight * row[j] * ry;
                    for (let k = 0; k < 3; k++)
                        matrix[j][k] += weight * row[j] * row[k];
                }
            }
        const x = solve(matrix, rhsX), y = solve(matrix, rhsY);
        if (!x || !y)
            break;
        const measured = source[split], d = Math.hypot(x[1] - measured.xMm, y[1] - measured.yMm);
        if (d > .9) {
            x[1] = measured.xMm + (x[1] - measured.xMm) * .9 / d;
            y[1] = measured.yMm + (y[1] - measured.yMm) * .9 / d;
            const free = [0, 2], G = free.map(j => free.map(k => matrix[j][k])), xx = solve(G, free.map(j => rhsX[j] - matrix[j][1] * x[1])), yy = solve(G, free.map(j => rhsY[j] - matrix[j][1] * y[1]));
            if (!xx || !yy)
                break;
            free.forEach((j, k) => { x[j] = xx[k]; y[j] = yy[k]; });
        }
        const points = x.map((v, i) => ({ id: '', xMm: v, yMm: y[i] })), knot = { ...measured, xMm: points[1].xMm, yMm: points[1].yMm }, candidate: Arc[] = [{ a: arcs[0].a, c1: arcs[0].c1, c2: points[0], b: knot }, { a: knot, c1: points[2], c2: arcs[1].c2, b: arcs[1].b }];
        const handles = candidate.every(c => length(c.a, c.b) >= 4 - 1e-7 && length(c.a, c.c1) <= 1.5 * length(c.a, c.b) && length(c.b, c.c2) <= 1.5 * length(c.a, c.b)), direction = candidate.every((c, i) => supportedDirection(source.slice(i ? split : 0, i ? source.length : split + 1), c, grid));
        if (handles && direction) {
            let flat: Point[] | undefined;
            try {
                flat = join(flatten(candidate[0]), flatten(candidate[1]));
            }
            catch { /* Preserve any earlier valid data fit. */ }
            if (flat && flat.length <= 4000) {
                const rms = residual(sourceMetric, flat);
                if (rms !== undefined && rms < beforeRms - 1e-8 && (!best || rms < best.rms)) {
                    const error = Math.max(options.tools.spanError(source, flat, 1, .1), options.tools.spanError(flat, source, 1, .1));
                    if (error + .06 <= 1.05)
                        best = { arcs: candidate, rms, error };
                }
            }
        }
        for (let side = 0; side < 2; side++) {
            const c = candidate[side], P = [c.a, c.c1, c.c2, c.b], t = parameters[side], next = [...t];
            for (let i = 1; i + 1 < t.length; i++) {
                const u = t[i], s = 1 - u, B = basis(u), D = [-3 * s * s, 3 * s * s - 6 * s * u, 6 * s * u - 3 * u * u, 3 * u * u], DD = [6 * s, -12 * s + 6 * u, 6 * s - 12 * u, 6 * u], target = spans[side][i], dx = P.reduce((v, p, k) => v + D[k] * p.xMm, 0), dy = P.reduce((v, p, k) => v + D[k] * p.yMm, 0), rx = P.reduce((v, p, k) => v + B[k] * p.xMm, 0) - target.xMm, ry = P.reduce((v, p, k) => v + B[k] * p.yMm, 0) - target.yMm, ddx = P.reduce((v, p, k) => v + DD[k] * p.xMm, 0), ddy = P.reduce((v, p, k) => v + DD[k] * p.yMm, 0), den = dx * dx + dy * dy + rx * ddx + ry * ddy;
                if (Math.abs(den) > 1e-12)
                    next[i] = Math.max((t[i - 1] + u) / 2, Math.min((u + t[i + 1]) / 2, u - (rx * dx + ry * dy) / den));
            }
            parameters[side] = next;
        }
    }
    if (!best)
        return;
    const world = (p: Point): Point => ({ id: options.createId(), xMm: origin.xMm + p.xMm * pixel, yMm: origin.yMm + p.yMm * pixel }), knot = { ...worldK, xMm: origin.xMm + best.arcs[0].b.xMm * pixel, yMm: origin.yMm + best.arcs[0].b.yMm * pixel }, outerFirst = existing[0]?.c1 ?? world(arcs[0].c1), outerLast = existing[1]?.c2 ?? world(arcs[1].c2);
    const curves: Curve[] = [{ id: options.createId(), startNodeId: worldA.id, endNodeId: knot.id, c1: outerFirst, c2: world(best.arcs[0].c2) }, { id: options.createId(), startNodeId: knot.id, endNodeId: worldB.id, c1: world(best.arcs[1].c1), c2: outerLast }];
    return { nodes: [worldA, knot, worldB], curves, rms: best.rms * pixel, beforeRms: beforeRms * pixel, error: best.error * pixel, splitIndex: split };
}
