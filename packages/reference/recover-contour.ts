import type { Piece, Point } from '../schema/index';
import { safeContour, contourBoundaryError } from './contour-topology';
import {boxIndex,type Box} from '../surface/spatial';
type Curve = NonNullable<Piece['curves']>[number];
type Segment = {
    a: Point;
    b: Point;
    curve?: Curve;
    line?: {
        nx: number;
        ny: number;
        offset: number;
    };
};
const distance = (p: Point, a: Point, b: Point) => { const x = b.xMm - a.xMm, y = b.yMm - a.yMm, d = x * x + y * y, t = d ? Math.max(0, Math.min(1, ((p.xMm - a.xMm) * x + (p.yMm - a.yMm) * y) / d)) : 0; return Math.hypot(p.xMm - a.xMm - t * x, p.yMm - a.yMm - t * y); };
const length = (a: Point, b: Point) => Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
const area = (r: Point[]) => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length], o = r[0]; return s + (a.xMm - o.xMm) * (b.yMm - o.yMm) - (b.xMm - o.xMm) * (a.yMm - o.yMm); }, 0) / 2;
function grid(points: Point[], pixel: number) {
    const candidates = points.map((p, i) => { const q = points[(i + 1) % points.length], d = length(p, q); return { x: q.xMm - p.xMm, y: q.yMm - p.yMm, d }; }).filter(e => e.d > pixel * .5 && e.d < pixel * 2);
    const measured = [...candidates].sort((a, b) => a.d - b.d)[Math.floor(candidates.length * .1)]?.d;
    // Unit raster edges tie geometrically. Resolve those ties by original
    // traversal order, so scale/rotation roundoff cannot flip the chosen axis.
    const e = candidates.find(e => measured !== undefined && Math.abs(e.d - measured) <= pixel * 1e-6);
    return e ? { size: e.d, ux: e.x / e.d, uy: e.y / e.d } : { size: pixel / .8, ux: 1, uy: 0 };
}
type Grid = ReturnType<typeof grid>;
/** Minimax digital straight-span fit. Raw vertices outline whole pixel cells;
 * the permitted Euclidean strip is at most 1.8 native pixels wide (0.9 on
 * each side), independent of calibration or raster rotation. This is a
 * recognition bound, not the final geometric error contract. */
function straight(points: Point[], g: Grid) {
    const origin = points[0], p = points.map(p => ({ x: (p.xMm - origin.xMm) * g.ux + (p.yMm - origin.yMm) * g.uy, y: -(p.xMm - origin.xMm) * g.uy + (p.yMm - origin.yMm) * g.ux })), end = p.at(-1)!, swap = Math.abs(end.y) > Math.abs(end.x), sx = Math.sign(swap ? end.y : end.x) || 1, sy = Math.sign(swap ? end.x : end.y) || 1;
    const coordinates = p.map(p => ({ x: sx * (swap ? p.y : p.x), y: sy * (swap ? p.x : p.y) }));
    let previous = -Infinity;
    for (const q of coordinates) {
        const advance = q.x + q.y;
        if (advance < previous - g.size * 1.01)
            return undefined;
        previous = Math.max(previous, advance);
    }
    const strip = (t: number) => { let lo = Infinity, hi = -Infinity; for (const q of coordinates) {
        const v = (1 - t) * q.y - t * q.x;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
    } return { width: hi - lo, offset: (hi + lo) / 2 }; };
    const width = (t: number) => strip(t).width / Math.hypot(t, 1 - t);
    let lo = 0, hi = .5;
    for (let i = 0; i < 36; i++) {
        const a = (2 * lo + hi) / 3, b = (lo + 2 * hi) / 3;
        if (width(a) < width(b))
            hi = b;
        else
            lo = a;
    }
    const best = [0, .5, (lo + hi) / 2].map(t => ({ t, ...strip(t) })).sort((a, b) => a.width / Math.hypot(a.t, 1 - a.t) - b.width / Math.hypot(b.t, 1 - b.t))[0];
    if (best.width > Math.max(g.size, 1.8 * g.size * Math.hypot(best.t, 1 - best.t)) + g.size * 1e-6)
        return undefined;
    let nx = -best.t * sx, ny = (1 - best.t) * sy;
    if (swap)
        [nx, ny] = [ny, nx];
    const wx = nx * g.ux - ny * g.uy, wy = nx * g.uy + ny * g.ux;
    return { nx: wx, ny: wy, offset: best.offset + wx * origin.xMm + wy * origin.yMm };
}
function corners(points: Point[], pixel: number) {
    const fixed = new Set<string>(), perimeter = points.reduce((s, p, i) => s + length(p, points[(i + 1) % points.length]), 0), position = [0];
    for (let i = 0; i < points.length; i++)
        position.push(position.at(-1)! + length(points[i], points[(i + 1) % points.length]));
    const at = (index: number, direction: number, reach: number) => { let p = points[index]; reach = Math.min(reach, perimeter * .15); for (let k = 0; k < points.length; k++) {
        const j = (index + direction + points.length) % points.length, q = points[j], d = length(p, q);
        if (d >= reach && d > 0) {
            const t = reach / d;
            return { xMm: p.xMm + (q.xMm - p.xMm) * t, yMm: p.yMm + (q.yMm - p.yMm) * t };
        }
        reach -= d;
        index = j;
        p = q;
    } return p; };
    const candidates: {
        i: number;
        strength: number;
        keep: boolean;
    }[] = [];
    const native = grid(points, pixel * .8);
    const supportingSpan = (index: number, direction: number) => {
        const span = [points[index]];
        let remaining = Math.min(pixel * 20, perimeter * .15);
        for (let k = 0; k < points.length; k++) {
            const next = (index + direction + points.length) % points.length, p = points[index], q = points[next], d = length(p, q);
            if (d >= remaining) {
                const t = remaining / d;
                span.push({ id: '', xMm: p.xMm + (q.xMm - p.xMm) * t, yMm: p.yMm + (q.yMm - p.yMm) * t });
                break;
            }
            span.push(q); remaining -= d; index = next;
        }
        return direction < 0 ? span.reverse() : span;
    };
    for (let i = 0; i < points.length; i++) {
        if (Math.min(length(points[i], points[(i + points.length - 1) % points.length]), length(points[i], points[(i + 1) % points.length])) < Math.min(.04, pixel * .1)) {
            fixed.add(points[i].id);
            continue;
        }
        const turns = [4, 8, 12].map(scale => { const a = at(i, -1, pixel * scale), p = points[i], b = at(i, 1, pixel * scale), ux = p.xMm - a.xMm, uy = p.yMm - a.yMm, vx = b.xMm - p.xMm, vy = b.yMm - p.yMm; return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); });
        // A corner has comparable turning at short and longer reaches. On a
        // painted arc the turn grows with reach; marking it fixed splits that
        // real curvature into polygon bends before data fitting can recover it.
        const magnitudes = turns.map(Math.abs), cappedTip = magnitudes[0] >= Math.PI * .45 && Math.min(...magnitudes.slice(1)) >= Math.PI * .65;
        // A few terminal pixel cells can bevel a genuinely acute tip. Its
        // short reach still turns sharply and both longer reaches confirm
        // the acute arms; do not confuse that cap with a broad painted arc.
        const stable = magnitudes[0] >= Math.max(...magnitudes.slice(1)) * .8 || magnitudes[0] >= Math.PI * .6 || cappedTip;
        const eligible = turns.every(t => Math.sign(t) === Math.sign(turns[0])) && Math.min(...magnitudes) > .35 && Math.abs(turns[1]) > .7;
        const supportedIntersection = eligible && !stable && straight(supportingSpan(i, -1), native) && straight(supportingSpan(i, 1), native);
        if (eligible)
            candidates.push({ i, strength: Math.abs(turns[1]), keep: !!(stable || supportedIntersection) });
    }
    const selected: number[] = [];
    for (const { i, keep } of candidates.sort((a, b) => b.strength - a.strength || a.i - b.i)) {
        if (selected.some(j => { const arc = Math.abs(position[i] - position[j]); return Math.min(arc, perimeter - arc) < pixel * 3; }))
            continue;
        selected.push(i);
        if (keep) fixed.add(points[i].id);
    }
    return { fixed, at };
}
function flatten(a: Point, c1: Point, c2: Point, b: Point, tolerance: number, createId: () => string) {
    const output: Point[] = [], mid = (a: Point, b: Point) => ({ id: createId(), xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 });
    const append = (a: Point, c1: Point, c2: Point, b: Point, depth: number) => { if (depth > 20 || output.length > 4000)
        throw Error('RESOURCE_LIMIT'); if (Math.max(distance(c1, a, b), distance(c2, a, b)) <= tolerance) {
        output.push(a);
        return;
    } const p = mid(a, c1), q = mid(c1, c2), r = mid(c2, b), s = mid(p, q), t = mid(q, r), m = mid(s, t); append(a, p, s, m, depth + 1); append(m, t, r, b, depth + 1); };
    append(a, c1, c2, b, 0);
    output.push(b);
    return output;
}
function spanError(a: Point[], b: Point[], pixel: number, spacing = pixel * .2) {
    let maximum = 0;
    // Only distances within the acceptance radius can affect a successful
    // fit. Index longer flattened arcs rather than scanning every edge for
    // every raster sample; short chords retain the cheaper direct path.
    const boxes: Box[] | undefined = b.length > 16 ? b.slice(0, -1).map((p, i) => [Math.min(p.xMm, b[i + 1].xMm), Math.min(p.yMm, b[i + 1].yMm), Math.max(p.xMm, b[i + 1].xMm), Math.max(p.yMm, b[i + 1].yMm)]) : undefined;
    const index = boxes ? boxIndex(boxes) : undefined, radius = pixel * 1.05;
    for (let i = 0; i + 1 < a.length; i++) {
        const p = a[i], q = a[i + 1], count = Math.max(1, Math.ceil(length(p, q) / spacing));
        for (let j = 0; j <= count; j++) {
            const t = j / count, r = { id: '', xMm: p.xMm + (q.xMm - p.xMm) * t, yMm: p.yMm + (q.yMm - p.yMm) * t };
            let nearest = Infinity;
            if (index) {
                for (const k of index.query([r.xMm - radius, r.yMm - radius, r.xMm + radius, r.yMm + radius])) nearest = Math.min(nearest, distance(r, b[k], b[k + 1]));
            } else {
                for (let k = 0; k + 1 < b.length; k++) nearest = Math.min(nearest, distance(r, b[k], b[k + 1]));
            }
            maximum = Math.max(maximum, nearest);
            if (maximum > pixel * 1.05)
                return maximum;
        }
    }
    return maximum;
}
/** A short measured span cannot acquire a backwards tangent where its raster
 * edges consistently advance. Longer arcs can hide their true extrema within
 * the terminal pixel cells, so do not infer exact monotonicity from those. */
function shortSpanDirection(span: Point[], curve: Curve, g: Grid) {
    const arc = span.slice(1).reduce((s, p, i) => s + length(span[i], p), 0);
    if (arc > g.size * 12) return true;
    const a = span[0], b = span.at(-1)!, epsilon = g.size * 1e-7;
    for (const [x, y] of [[g.ux, g.uy], [-g.uy, g.ux]]) {
        const coordinate = (p: Point) => (p.xMm - a.xMm) * x + (p.yMm - a.yMm) * y;
        const values = span.map(coordinate), advance = values.at(-1)!;
        if (Math.abs(advance) < g.size * 4) continue;
        const sign = Math.sign(advance);
        if (values.some((v, i) => i > 0 && sign * (v - values[i - 1]) < -epsilon)) continue;
        const p = sign * coordinate(curve.c1), q = sign * (coordinate(curve.c2) - coordinate(curve.c1)), r = sign * (coordinate(b) - coordinate(curve.c2));
        const quadratic = p - 2 * q + r, t = quadratic > 0 ? (p - q) / quadratic : -1;
        const minimum = Math.min(p, r, t > 0 && t < 1 ? p + 2 * (q - p) * t + quadratic * t * t : Infinity);
        if (minimum < -epsilon) return false;
    }
    return true;
}
/** Recover controls directly from source coordinates. Raster chord tangents
 * can constrain a genuine arc to the wrong direction; independent least
 * squares controls avoid that bias. Endpoints remain exact, and no continuity,
 * curvature energy or aesthetic smoothness term enters this fit. */
function geometricCubic(span: Point[], g: Grid, createId: () => string, requireCurvedCore = true, refine = false): Curve | undefined {
    if (span.length < 5) return;
    const a = span[0], b = span.at(-1)!, d = length(a, b);
    if (d < g.size * 4) return;
    const arc = [0];
    for (let i = 1; i < span.length; i++) arc.push(arc.at(-1)! + length(span[i - 1], span[i]));
    const core = span.filter((_, i) => arc[i] > g.size * 2 && arc.at(-1)! - arc[i] > g.size * 2);
    if (requireCurvedCore && core.length >= 3 && straight(core, g)) return;
    const parameters = arc.map(t => t / arc.at(-1)!);
    let best:Curve|undefined,bestError=Infinity;
    for (let iteration = 0; iteration < 12; iteration++) {
        let aa = 0, ab = 0, bb = 0, ax = 0, bx = 0, ay = 0, by = 0;
        for (let i = 1; i + 1 < span.length; i++) {
            const t = parameters[i], s = 1 - t, b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
            const rx = span[i].xMm - b0 * a.xMm - b3 * b.xMm, ry = span[i].yMm - b0 * a.yMm - b3 * b.yMm;
            aa += b1 * b1; ab += b1 * b2; bb += b2 * b2;
            ax += b1 * rx; bx += b2 * rx; ay += b1 * ry; by += b2 * ry;
        }
        const det = aa * bb - ab * ab;
        if (det <= 1e-12) return best;
        const c1 = { id: createId(), xMm: (ax * bb - bx * ab) / det, yMm: (ay * bb - by * ab) / det };
        const c2 = { id: createId(), xMm: (bx * aa - ax * ab) / det, yMm: (by * aa - ay * ab) / det };
        if (length(a, c1) > d * 1.5 || length(b, c2) > d * 1.5) return best;
        const c: Curve = { id: createId(), startNodeId: a.id, endNodeId: b.id, c1, c2 };
        try {
            const sampled = flatten(a, c1, c2, b, g.size * .01, createId);
            // .1-pixel sampling contributes .05; flattening contributes .01.
            const error=Math.max(spanError(span, sampled, g.size, g.size * .1), spanError(sampled, span, g.size, g.size * .1)) + g.size * .06;
            if (shortSpanDirection(span,c,g)&&error<=g.size*1.05){
                if(!refine)return c;
                if(error<bestError){best=c;bestError=error;}
            }
        } catch { return best; }
        const p = [a, c1, c2, b], next = [...parameters];
        for (let j = 1; j + 1 < span.length; j++) {
            const t = parameters[j], s = 1 - t, B = [s * s * s, 3 * t * s * s, 3 * t * t * s, t * t * t];
            const D = [-3 * s * s, 3 * s * s - 6 * s * t, 6 * s * t - 3 * t * t, 3 * t * t], DD = [6 * s, -12 * s + 6 * t, 6 * s - 12 * t, 6 * t];
            const x = p.reduce((v, p, k) => v + B[k] * p.xMm, 0) - span[j].xMm, y = p.reduce((v, p, k) => v + B[k] * p.yMm, 0) - span[j].yMm;
            const dx = p.reduce((v, p, k) => v + D[k] * p.xMm, 0), dy = p.reduce((v, p, k) => v + D[k] * p.yMm, 0);
            const ddx = p.reduce((v, p, k) => v + DD[k] * p.xMm, 0), ddy = p.reduce((v, p, k) => v + DD[k] * p.yMm, 0), den = dx * dx + dy * dy + x * ddx + y * ddy;
            if (Math.abs(den) > 1e-12) next[j] = Math.max((parameters[j - 1] + t) / 2, Math.min((t + parameters[j + 1]) / 2, t - (x * dx + y * dy) / den));
        }
        parameters.splice(0, parameters.length, ...next);
    }
    return best;
}

function ring(points: Point[], pixel: number, createId: () => string, allowCurves: boolean, boundaryCorner = false, retainCorners = false, forced:ReadonlySet<string>=new Set(), openChain = false) {
    const g = grid(points, pixel), { fixed, at } = corners(points, g.size), lookup = new Map(points.map((p, i) => [p.id, i])), anchors = new Set<number>();
    for(const id of forced)fixed.add(id);
    // Use the inferred raster axis so rotating calibration cannot introduce
    // different split anchors along an otherwise identical digital boundary.
    let left = 0, right = 0;
    for (let i = 0; i < points.length; i++) {
        if (points[i].xMm * g.ux + points[i].yMm * g.uy < points[left].xMm * g.ux + points[left].yMm * g.uy)
            left = i;
        if (points[i].xMm * g.ux + points[i].yMm * g.uy > points[right].xMm * g.ux + points[right].yMm * g.uy)
            right = i;
        if (fixed.has(points[i].id))
            anchors.add(i);
    }
    anchors.add(left);
    anchors.add(right);
    const tangent = (p: Point) => { const i = lookup.get(p.id)!, a = at(i, -1, g.size * 6), b = at(i, 1, g.size * 6), d = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm); return d ? { x: (b.xMm - a.xMm) / d, y: (b.yMm - a.yMm) / d } : { x: 1, y: 0 }; };
    const cubic = (span: Point[], requireCurvedCore = true): Curve | undefined => {
        if (!allowCurves || span.length < 5)
            return undefined;
        const a = span[0], b = span.at(-1)!, d = length(a, b);
        if (d < g.size * 4)
            return undefined;
        const arc = [0];
        for (let j = 1; j < span.length; j++)
            arc.push(arc.at(-1)! + length(span[j - 1], span[j]));
        const core = span.filter((_, j) => arc[j] > g.size * 2 && arc.at(-1)! - arc[j] > g.size * 2);
        if (requireCurvedCore && core.length >= 3 && straight(core, g))
            return undefined;
        const oneSided = (p: Point, direction: number) => { const q = at(lookup.get(p.id)!, direction, Math.min(g.size * 6, arc.at(-1)! * .25)), dx = (q.xMm - p.xMm) * direction, dy = (q.yMm - p.yMm) * direction, n = Math.hypot(dx, dy); return n ? { x: dx / n, y: dy / n } : tangent(p); }, u = fixed.has(a.id) ? oneSided(a, 1) : tangent(a), v = fixed.has(b.id) ? oneSided(b, -1) : tangent(b);
        const parameters = arc.map(t => t / arc.at(-1)!);
        for (let iteration = 0; iteration < 6; iteration++) {
            let aa = 0, ab = 0, bb = 0, ax = 0, bx = 0;
            for (let j = 1; j + 1 < span.length; j++) {
                const t = parameters[j], s = 1 - t, b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t, rx = span[j].xMm - (b0 + b1) * a.xMm - (b2 + b3) * b.xMm, ry = span[j].yMm - (b0 + b1) * a.yMm - (b2 + b3) * b.yMm, ux = u.x * b1, uy = u.y * b1, vx = -v.x * b2, vy = -v.y * b2;
                aa += ux * ux + uy * uy;
                ab += ux * vx + uy * vy;
                bb += vx * vx + vy * vy;
                ax += ux * rx + uy * ry;
                bx += vx * rx + vy * ry;
            }
            const det = aa * bb - ab * ab;
            if (det <= 1e-12)
                return undefined;
            const l = (ax * bb - bx * ab) / det, r = (bx * aa - ax * ab) / det;
            if (l <= 0 || r <= 0 || l > d * 1.5 || r > d * 1.5)
                return undefined;
            const c: Curve = { id: createId(), startNodeId: a.id, endNodeId: b.id, c1: { id: createId(), xMm: a.xMm + u.x * l, yMm: a.yMm + u.y * l }, c2: { id: createId(), xMm: b.xMm - v.x * r, yMm: b.yMm - v.y * r } };
            try {
                const sampled = flatten(a, c.c1, c.c2, b, g.size * .01, createId);
                if (shortSpanDirection(span, c, g) && Math.max(spanError(span, sampled, g.size, g.size * .1), spanError(sampled, span, g.size, g.size * .1)) + g.size * .06 <= g.size * 1.05)
                    return c;
            }
            catch {
                return undefined;
            }
            // Raster arc length is direction biased (Manhattan stairs). Reparameterize
            // against the fitted curve before solving again; source coordinates stay
            // unchanged. This is geometric least squares, never energy minimization.
            const p = [a, c.c1, c.c2, b], next = [...parameters];
            for (let j = 1; j + 1 < span.length; j++) {
                const t = parameters[j], s = 1 - t, B = [s * s * s, 3 * t * s * s, 3 * t * t * s, t * t * t], D = [-3 * s * s, 3 * s * s - 6 * s * t, 6 * s * t - 3 * t * t, 3 * t * t], DD = [6 * s, -12 * s + 6 * t, 6 * s - 12 * t, 6 * t], x = p.reduce((v, p, k) => v + B[k] * p.xMm, 0) - span[j].xMm, y = p.reduce((v, p, k) => v + B[k] * p.yMm, 0) - span[j].yMm, dx = p.reduce((v, p, k) => v + D[k] * p.xMm, 0), dy = p.reduce((v, p, k) => v + D[k] * p.yMm, 0), ddx = p.reduce((v, p, k) => v + DD[k] * p.xMm, 0), ddy = p.reduce((v, p, k) => v + DD[k] * p.yMm, 0), den = dx * dx + dy * dy + x * ddx + y * ddy;
                if (Math.abs(den) > 1e-12)
                    next[j] = Math.max((parameters[j - 1] + t) / 2, Math.min((t + parameters[j + 1]) / 2, t - (x * dx + y * dy) / den));
            }
            parameters.splice(0, parameters.length, ...next);
        }
        return undefined;
    };
    const segments: Segment[] = [];
    const fit = (span: Point[], depth = 0) => {
        const a = span[0], b = span.at(-1)!, line = straight(span, g);
        if (line) {
            segments.push({ a, b, line });
            return;
        }
        if (depth < 20) {
            const c = allowCurves ? cubic(span) ?? geometricCubic(span, g, createId) : undefined;
            if (c) {
                segments.push({ a, b, curve: c });
                return;
            }
        }
        if (span.length <= 2) {
            segments.push({ a, b });
            return;
        }
        let index = 1, maximum = -1;
        for (let j = 1; j + 1 < span.length; j++) {
            const d = distance(span[j], a, b);
            if (d > maximum) {
                maximum = d;
                index = j;
            }
        }
        fit(span.slice(0, index + 1), depth + 1);
        fit(span.slice(index), depth + 1);
    };
    const order = [...anchors].sort((a, b) => a - b);
    for (let i = 0; i < order.length; i++) {
        const a = order[i], b = order[(i + 1) % order.length];
        fit(b > a ? points.slice(a, b + 1) : [...points.slice(a), ...points.slice(0, b + 1)]);
    }
    const bevel = (p: Point) => { const i = lookup.get(p.id)!; return Math.min(length(p, points[(i + points.length - 1) % points.length]), length(p, points[(i + 1) % points.length])) < Math.min(.04, g.size * .1); };
    // Corner detection proposes splits; pixel evidence decides whether a split
    // is real. Merge adjacent straight spans when one separating line explains
    // all their original samples, never crossing a native contact bevel.
    for (let changed = true; changed && segments.length > 3;) {
        changed = false;
        for (let i = 0; i < segments.length && segments.length > 3; i++) {
            const j = (i + 1) % segments.length, a = segments[i], b = segments[j];
            if (!a.line || !b.line || forced.has(b.a.id) || bevel(b.a) || retainCorners && fixed.has(b.a.id))
                continue;
            const start = lookup.get(a.a.id)!, end = lookup.get(b.b.id)!, span = end > start ? points.slice(start, end + 1) : [...points.slice(start), ...points.slice(0, end + 1)], line = straight(span, g);
            if (!line)
                continue;
            const merged = { a: a.a, b: b.b, line };
            if (j === 0) {
                segments[i] = merged;
                segments.splice(0, 1);
            }
            else
                segments.splice(i, 2, merged);
            changed = true;
            i--;
        }
    }
    // Intersect evidence-backed lines within one raster cell per coordinate.
    // Normally movement is capped at 0.9 pixels; the alternate local corner
    // fit instead caps distance to the two incident original edges at one pixel.
    // Native contact bevels and very acute tips stay exact. No area correction,
    // anchor averaging or bending-energy optimization is applied.
    const recoveredAnchors = new Map<string, Point>();
    const place = () => segments.map((segment, i) => { const p = recoveredAnchors.get(segment.a.id) ?? segment.a, previous = segments[(i + segments.length - 1) % segments.length], a0 = previous.a, b0 = segment.b, ux = p.xMm - a0.xMm, uy = p.yMm - a0.yMm, vx = b0.xMm - p.xMm, vy = b0.yMm - p.yMm, turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); if (forced.has(p.id) || bevel(p) || retainCorners && fixed.has(p.id) || fixed.has(p.id) && (Math.abs(turn) > Math.PI * .8) || !segment.line || !previous.line)
        return p; const a = previous.line, b = segment.line, det = a.nx * b.ny - a.ny * b.nx; if (Math.abs(det) < .05)
        return p; const x = (a.offset * b.ny - a.ny * b.offset) / det - p.xMm, y = (a.nx * b.offset - a.offset * b.nx) / det - p.yMm, u = Math.max(-g.size, Math.min(g.size, x * g.ux + y * g.uy)), v = Math.max(-g.size, Math.min(g.size, -x * g.uy + y * g.ux)); const index = lookup.get(p.id)!, near = [points[(index + points.length - 1) % points.length], p, points[(index + 1) % points.length]], point = (scale: number) => ({ ...p, xMm: p.xMm + (u * g.ux - v * g.uy) * scale, yMm: p.yMm + (u * g.uy + v * g.ux) * scale }), error = (scale: number) => Math.min(distance(point(scale), near[0], p), distance(point(scale), p, near[2])); let scale = Math.min(1, g.size * .9 / (Math.hypot(u, v) || 1)); if (boundaryCorner)
        scale = 1; if (boundaryCorner && error(1) > g.size) {
        let low = 0, high = 1;
        for (let j = 0; j < 24; j++) {
            const m = (low + high) / 2;
            if (error(m) > g.size)
                high = m;
            else
                low = m;
        }
        scale = low;
    } return point(scale); });
    if (!forced.size && !retainCorners && segments.length > 6 && !segments.some(s => s.curve) && points.length <= 512) {
        for (const start of new Set([0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor(points.length * 3 / 4)])) {
            const rotated = [...points.slice(start), ...points.slice(0, start)], path = [...rotated, rotated[0]], cost = new Float64Array(path.length).fill(Infinity), previous = new Int32Array(path.length).fill(-1), lines = new Map<number, NonNullable<Segment['line']>>();
            cost[0] = 0;
            for (let i = 0; i < points.length; i++) {
                if (!Number.isFinite(cost[i]))
                    continue;
                for (let j = i + 1; j < path.length; j++) {
                    if (j > i + 1 && bevel(path[j - 1]))
                        break;
                    const line = straight(path.slice(i, j + 1), g);
                    if (!line)
                        break;
                    if (cost[i] + 1 < cost[j]) {
                        cost[j] = cost[i] + 1;
                        previous[j] = i;
                        lines.set(j, line);
                    }
                }
            }
            if (cost[points.length] >= 3 && cost[points.length] < segments.length) {
                const optimal: Segment[] = [];
                for (let j = points.length; j > 0;) {
                    const i = previous[j];
                    if (i < 0)
                        break;
                    optimal.push({ a: path[i], b: path[j], line: lines.get(j)! });
                    j = i;
                }
                if (optimal.length === cost[points.length])
                    segments.splice(0, segments.length, ...optimal.reverse());
            }
        }
    }

    const consolidate = (requireCurvedCore: boolean, anchors?: ReadonlyMap<string, Point>) => {
        for (let i = 0; i < segments.length; i++) {
            for (let j = Math.min(segments.length - 1, i + 8); j > i; j--) {
                if (segments.slice(i + 1, j + 1).some(s => fixed.has(s.a.id) || forced.has(s.a.id) || bevel(s.a))) continue;
                const start = lookup.get(segments[i].a.id)!, end = lookup.get(segments[j].b.id)!;
                const raw = end > start ? points.slice(start, end + 1) : [...points.slice(start), ...points.slice(0, end + 1)];
                const span = anchors ? raw.map((p, k) => k === 0 || k === raw.length - 1 ? anchors.get(p.id) ?? p : p) : raw;
                if (straight(span, g)) continue;
                const c = cubic(span, requireCurvedCore) ?? geometricCubic(span, g, createId, requireCurvedCore);
                if (!c) continue;
                if (anchors) {
                    recoveredAnchors.set(span[0].id, span[0]);
                    recoveredAnchors.set(span.at(-1)!.id, span.at(-1)!);
                }
                segments.splice(i, j - i + 1, { a: segments[i].a, b: segments[j].b, curve: c });
                break;
            }
        }
    };
    if (allowCurves && !openChain) consolidate(true);
    let nodes = place();
    for (let pass = 0; pass < 12; pass++) {
        let changed = false;
        for (let i = segments.length - 1; i >= 0; i--) {
            const s = segments[i];
            if (s.curve)
                continue;
            const start = lookup.get(s.a.id)!, end = lookup.get(s.b.id)!, span = end > start ? points.slice(start, end + 1) : [...points.slice(start), ...points.slice(0, end + 1)];
            if (span.length <= 2)
                continue;
            let worst = -1, index = 1;
            for (let j = 1; j + 1 < span.length; j++) {
                const d = distance(span[j], nodes[i], nodes[(i + 1) % nodes.length]);
                if (d > worst) {
                    worst = d;
                    index = j;
                }
            }
            if (worst <= g.size * .95)
                continue;
            const p = span[index];
            segments.splice(i, 1, { a: s.a, b: p, line: straight(span.slice(0, index + 1), g) }, { a: p, b: s.b, line: straight(span.slice(index), g) });
            changed = true;
        }
        if (!changed)
            break;
        nodes = place();
    }
    for (let i = nodes.length - 1; i >= 0 && nodes.length > 3; i--) {
        const j = (i + 1) % nodes.length;
        if (!forced.has(nodes[i].id) && !forced.has(nodes[j].id) && !segments[i].curve && !segments[j].curve && !bevel(segments[i].a) && !bevel(segments[j].a) && length(nodes[i], nodes[j]) <= g.size * 1e-5) {
            segments[(i + segments.length - 1) % segments.length].b = segments[j].a;
            nodes.splice(i, 1);
            segments.splice(i, 1);
        }
    }
    // Remove redundant reconstructed line vertices using the original span,
    // rather than a visual smoothness objective or the previous fitted path.
    for (let changed = true; changed && nodes.length > 3;) {
        changed = false;
        for (let i = nodes.length - 1; i >= 0 && nodes.length > 3; i--) {
            const before = (i + nodes.length - 1) % nodes.length, after = (i + 1) % nodes.length;
            if (forced.has(nodes[i].id) || segments[before].curve || segments[i].curve || bevel(nodes[i]) || retainCorners && fixed.has(nodes[i].id))
                continue;
            const start = lookup.get(nodes[before].id)!, end = lookup.get(nodes[after].id)!, span = end > start ? points.slice(start, end + 1) : [...points.slice(start), ...points.slice(0, end + 1)], chord = [nodes[before], nodes[after]];
            if (Math.max(spanError(span, chord, g.size), spanError(chord, span, g.size)) > g.size * .95)
                continue;
            segments[before].b = segments[i].b;
            segments[before].line = straight(span, g);
            nodes.splice(i, 1);
            segments.splice(i, 1);
            changed = true;
        }
    }
    if (allowCurves && openChain) {
        // Retain endpoint coordinates recovered from supporting source lines.
        // Refitting an arc must not reset its neighbours to a different anchor.
        consolidate(false, new Map(nodes.map(p => [p.id, p])));
        nodes = place();
    }
    if (allowCurves && openChain) {
        // Independent fits can strand a one/two-cell straight step between
        // measured arcs. It is not a corner when the source corner detector
        // and junction graph both left its endpoints free. Refit those arcs
        // around the middle of the original step, retaining the remaining
        // raster samples when a longer continuation cannot be fitted.
        // Every owner still checks the complete source boundary and area.
        for (let i = 1; i + 1 < segments.length; i++) {
            const previous = segments[i - 1], step = segments[i], next = segments[i + 1];
            if (!previous.curve || step.curve || !next.curve ||
                [step.a, step.b].some(p => fixed.has(p.id) || forced.has(p.id) || bevel(p)) ||
                length(step.a, step.b) > g.size * 2 + g.size * 1e-7) continue;
            const start = lookup.get(previous.a.id)!, middle = lookup.get(step.a.id)!, end = lookup.get(next.b.id)!;
            if (start >= middle || middle >= end) continue;
            const join = { ...step.a, xMm: (step.a.xMm + step.b.xMm) / 2, yMm: (step.a.yMm + step.b.yMm) / 2 };
            const left = points.slice(start, middle + 1);
            left[0] = nodes[i - 1]; left[left.length - 1] = join;
            const incoming = cubic(left, false) ?? geometricCubic(left, g, createId, false, true);
            if (!incoming) continue;
            const right = points.slice(middle, end + 1);
            right[0] = join; right[right.length - 1] = nodes[i + 2];
            for (let stop = right.length - 1; stop >= 4; stop--) {
                const prefix = right.slice(0, stop + 1), outgoing = cubic(prefix, false);
                if (!outgoing) continue;
                const replacements:Segment[] = [{ a: previous.a, b: join, curve: incoming }, { a: join, b: prefix.at(-1)!, curve: outgoing }];
                for (let k = stop; k + 1 < right.length; k++) replacements.push({ a: right[k], b: right[k + 1] });
                recoveredAnchors.set(join.id, join);
                segments.splice(i - 1, 3, ...replacements);
                nodes = place();
                break;
            }
        }
    }
    let curves = segments.flatMap(s => s.curve ? [s.curve] : []);
    if (nodes.length === 2 && curves.length) {
        // Two fitted arcs can describe a valid closed loop, while the editable
        // and native schemas require at least three anchors. Split one arc
        // exactly with de Casteljau; this adds no shape approximation.
        const curve = curves[0], a = nodes.find(n => n.id === curve.startNodeId)!, b = nodes.find(n => n.id === curve.endNodeId)!;
        const mid = (p: Point, q: Point): Point => ({ id: createId(), xMm: (p.xMm + q.xMm) / 2, yMm: (p.yMm + q.yMm) / 2 });
        const p = mid(a, curve.c1), q = mid(curve.c1, curve.c2), r = mid(curve.c2, b), s = mid(p, q), t = mid(q, r), center = mid(s, t);
        nodes.splice(nodes.indexOf(a) + 1, 0, center);
        curves = [...curves.filter(c => c !== curve), { ...curve, endNodeId: center.id, c1: p, c2: s }, { ...curve, id: createId(), startNodeId: center.id, c1: t, c2: r }];
    }
    return { nodes, curves, segments, fixed, g };
}
/** A nearly parallel narrow strip is ill-conditioned: independent raster-line
 * intercepts can bias its measured thickness. Keep both directions and native
 * clipping coordinates; enforce the existing 3% measured-area constraint with
 * the smallest one-dimensional normal adjustment, then apply the same full
 * boundary/topology checks. This never creates curves or smooths corners. */
function narrowMeasuredStrip(candidate: Piece, original: Piece, g: Grid, pixel: number): Piece | undefined {
    if (candidate.curves?.length || original.holes?.length || candidate.nodes.length > 20)
        return;
    const edges = candidate.nodes.map((a, i) => { const b = candidate.nodes[(i + 1) % candidate.nodes.length], d = length(a, b); return { a, b, d, ux: (b.xMm - a.xMm) / d, uy: (b.yMm - a.yMm) / d }; }).sort((a, b) => b.d - a.d), main = edges[0];
    if (!main)
        return;
    const parallel = edges.find((e, i) => i > 0 && e.d > main.d * .6 && main.ux * e.ux + main.uy * e.uy < -.995);
    if (!parallel)
        return;
    const nx = -main.uy, ny = main.ux, values = candidate.nodes.map(p => p.xMm * nx + p.yMm * ny), low = Math.min(...values), high = Math.max(...values), width = high - low;
    if (width > g.size * 12 || main.d < width * 10)
        return;
    const measured = Math.abs(area(original.nodes)), current = Math.abs(area(candidate.nodes));
    if (!measured || Math.abs(current - measured) <= measured * .03)
        return;
    const center = (low + high) / 2, xmin = Math.min(...original.nodes.map(p => p.xMm)), xmax = Math.max(...original.nodes.map(p => p.xMm)), ymin = Math.min(...original.nodes.map(p => p.yMm)), ymax = Math.max(...original.nodes.map(p => p.yMm)), eps = g.size * 1e-7;
    const at = (shift: number) => ({ ...candidate, nodes: candidate.nodes.map(p => { const side = p.xMm * nx + p.yMm * ny < center ? -1 : 1, dx = nx * shift * side / 2, dy = ny * shift * side / 2; return { ...p, xMm: Math.abs(p.xMm - xmin) < eps || Math.abs(p.xMm - xmax) < eps ? p.xMm : p.xMm + dx, yMm: Math.abs(p.yMm - ymin) < eps || Math.abs(p.yMm - ymax) < eps ? p.yMm : p.yMm + dy }; }) });
    const target = measured * (current > measured ? 1.029 : .971);
    let shift = 0;
    for (let i = 0; i < 8; i++) {
        const a = Math.abs(area(at(shift).nodes)), step = g.size * .01, derivative = (Math.abs(area(at(shift + step).nodes)) - a) / step;
        if (Math.abs(derivative) < 1e-10)
            return;
        shift += (target - a) / derivative;
        if (Math.abs(shift) > g.size * .5)
            return;
    }
    const result = at(shift);
    return safeContour(result, original, pixel) && contourBoundaryError(result, original, g.size * .1, g.size * 1.05) <= g.size * 1.05 ? result : undefined;
}
/** Recover raster geometry: straight sides first, data-fitted arcs only where
 * the boundary cannot be explained by a digital straight segment. Every fit
 * must pass topology, <=3% per-ring area error, and a conservative global
 * 1.05-native-pixel bidirectional boundary bound, including sample margins.
 * No aesthetically smooth, C1, equal-area or averaged-anchor objective is used. */
function recoverLocal(piece: Piece, pixelMm: number, createId: () => string): Piece {
    if (!Number.isFinite(pixelMm) || pixelMm <= 0)
        throw Error('INVALID_CALIBRATION');
    if (piece.nodes.length < 5 && !piece.holes?.length)
        return { ...piece, curves: [] };
    const outer = ring(piece.nodes, pixelMm, createId, true), holes = piece.holes?.map(h => {
        if (Math.abs(area(h)) < outer.g.size * outer.g.size * 16)
            return h;
        const r = ring(h, pixelMm, createId, true), curves = new Map(r.curves.map(c => [c.startNodeId, c]));
        return r.nodes.flatMap((a, i) => { const c = curves.get(a.id), b = r.nodes[(i + 1) % r.nodes.length]; return c ? flatten(a, c.c1, c.c2, b, outer.g.size * .1, createId).slice(0, -1) : [a]; });
    });
    let candidate: Piece = { ...piece, nodes: outer.nodes, curves: outer.curves, holes };
    const compactLines = (input: Piece) => {
      let candidate = input;
      if (!candidate.curves?.length && candidate.nodes.length <= 32 && piece.nodes.length <= 512) {
        const source = new Map(piece.nodes.map((p, i) => [p.id, i])), bevel = (p: Point) => { const i = source.get(p.id)!; return Math.min(length(p, piece.nodes[(i + piece.nodes.length - 1) % piece.nodes.length]), length(p, piece.nodes[(i + 1) % piece.nodes.length])) < Math.min(.04, outer.g.size * .1); };
        for (let changed = true; changed && candidate.nodes.length > 3;) {
            changed = false;
            for (let i = candidate.nodes.length - 1; i >= 0 && candidate.nodes.length > 3; i--) {
                if (bevel(candidate.nodes[i]))
                    continue;
                const next = { ...candidate, nodes: candidate.nodes.filter((_, j) => j !== i) };
                if (safeContour(next, piece, pixelMm) && contourBoundaryError(next, piece, outer.g.size * .1, outer.g.size) <= outer.g.size) {
                    candidate = next;
                    changed = true;
                }
            }
        }
      }
      return candidate;
    };
    candidate = compactLines(candidate);
    if (candidate.curves?.length && candidate.nodes.length <= 32 && piece.nodes.length <= 512) {
        const lines = ring(piece.nodes, pixelMm, createId, false), compact = compactLines({ ...candidate, nodes: lines.nodes, curves: [] }), polygon = narrowMeasuredStrip(compact, piece, outer.g, pixelMm) ?? compact;
        // Prefer a smaller source-supported straight representation whenever it
        // meets the same complete error and topology contract. A few irregular
        // tip pixels must not turn the painted side of a diamond into an arc.
        if (polygon.nodes.length < candidate.nodes.length && safeContour(polygon, piece, pixelMm) && contourBoundaryError(polygon, piece, pixelMm * .1, outer.g.size * 1.05) <= outer.g.size * 1.05) candidate = polygon;
    }
    if (safeContour(candidate, piece, pixelMm) && contourBoundaryError(candidate, piece, pixelMm * .1, outer.g.size * 1.05) <= outer.g.size * 1.05)
        return candidate;
    const originalHoles = { ...candidate, holes: piece.holes };
    if (safeContour(originalHoles, piece, pixelMm) && contourBoundaryError(originalHoles, piece, pixelMm * .1, outer.g.size * 1.05) <= outer.g.size * 1.05)
        return originalHoles;
    // If compact joins cannot preserve a narrow region, restore only its
    // evidence-supported corner anchors, not the entire raster staircase.
    const anchored = ring(piece.nodes, pixelMm, createId, true, false, true), anchoredPiece = { ...piece, nodes: anchored.nodes, curves: anchored.curves, holes: piece.holes };
    if (safeContour(anchoredPiece, piece, pixelMm) && contourBoundaryError(anchoredPiece, piece, pixelMm * .1, outer.g.size * 1.05) <= outer.g.size * 1.05)
        return anchoredPiece;
    const repair = ring(piece.nodes, pixelMm, createId, true, true), repaired = { ...piece, nodes: repair.nodes, curves: repair.curves, holes: piece.holes };
    if (safeContour(repaired, piece, pixelMm) && contourBoundaryError(repaired, piece, pixelMm * .1, outer.g.size * 1.05) <= outer.g.size * 1.05)
        return repaired;
    const polygon = ring(piece.nodes, pixelMm, createId, false), fallback = { ...piece, nodes: polygon.nodes, curves: [], holes: piece.holes };
    if (safeContour(fallback, piece, pixelMm) && contourBoundaryError(fallback, piece, pixelMm * .1, outer.g.size * 1.05) <= outer.g.size * 1.05)
        return fallback;
    // A physically complex or irreducible invalid contour must be explicit,
    // never silently returned above the editable-node contract.
    for (const option of [originalHoles, anchoredPiece, repaired, fallback]) {
        const measured = narrowMeasuredStrip(option, piece, outer.g, pixelMm);
        if (measured)
            return measured;
    }
    if (piece.nodes.length > 2000)
        throw Error('RESOURCE_LIMIT');
    return { ...piece, curves: [] };
}
/** Work around the raster origin so line intersections cannot subtract large,
 * nearly equal world coordinates. The recovered shape is translation invariant. */
export function recoverContour(piece: Piece, pixelMm: number, createId: () => string): Piece {
    const origin = piece.nodes[0];
    if (!origin)
        return recoverLocal(piece, pixelMm, createId);
    const toLocal = (p: Point) => ({ ...p, xMm: p.xMm - origin.xMm, yMm: p.yMm - origin.yMm });
    const toWorld = (p: Point) => ({ ...p, xMm: p.xMm + origin.xMm, yMm: p.yMm + origin.yMm });
    const local = { ...piece, nodes: piece.nodes.map(toLocal), holes: piece.holes?.map(h => h.map(toLocal)) };
    const result = recoverLocal(local, pixelMm, createId);
    return { ...result, nodes: result.nodes.map(toWorld), holes: result.holes?.map(h => h.map(toWorld)), curves: result.curves?.map(c => ({ ...c, c1: toWorld(c.c1), c2: toWorld(c.c2) })) };
}

/** Fit an open source-boundary chain with its true junction endpoints fixed.
 * The distant closing scaffold only reuses the existing digital line/arc fitter;
 * it is discarded and is never a source contour or area constraint. */
export function recoverBoundaryChain(points:Point[],pixelMm:number,createId:()=>string){
 if(points.length<3)return {nodes:points,curves:[] as Curve[]};
 if(!Number.isFinite(pixelMm)||pixelMm<=0)throw Error('INVALID_CALIBRATION');
 // Fit in native raster coordinates: rotated/calibrated roundoff must not
 // choose a different split for the same measured boundary. Only numerical
 // noise at exact grid stations is snapped; native contact bevels stay intact.
 const origin=points[0],basis=grid(points,pixelMm),snap=(v:number)=>Math.abs(v-Math.round(v))<1e-7?Math.round(v):v;
 const local=points.map(p=>{const x=p.xMm-origin.xMm,y=p.yMm-origin.yMm;return {...p,xMm:snap((x*basis.ux+y*basis.uy)/basis.size),yMm:snap((-x*basis.uy+y*basis.ux)/basis.size)};});
 const fit=recoverBoundaryChainLocal(local,pixelMm/basis.size,createId);
 const world=(p:Point)=>({...p,xMm:origin.xMm+basis.size*(p.xMm*basis.ux-p.yMm*basis.uy),yMm:origin.yMm+basis.size*(p.xMm*basis.uy+p.yMm*basis.ux)});
 return {nodes:fit.nodes.map(p=>p.id===points[0].id?points[0]:p.id===points.at(-1)!.id?points.at(-1)!:world(p)),curves:fit.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};
}
function recoverBoundaryChainLocal(points:Point[],pixelMm:number,createId:()=>string){
 if(points.length<3)return {nodes:points,curves:[] as Curve[]};
 const origin=points[0],local=points.map(p=>({...p,xMm:p.xMm-origin.xMm,yMm:p.yMm-origin.yMm})),a=local[0],b=local.at(-1)!,d=length(a,b),reach=Math.max(pixelMm*20,...local.map(p=>length(a,p)))*3;
 if(d<1e-12)return {nodes:points,curves:[] as Curve[]};
 const native=grid(local,pixelMm),support=straight(local,native);
 // A digital straight strip can have clipped raster junctions off its
 // supporting line. Keep those junctions exact, recover the measured interior
 // direction, and confine the connecting caps to four native pixels.
 if(support&&d>native.size*12&&!local.some((p,i)=>i>0&&length(p,local[i-1])<Math.min(.04,native.size*.1))){
  let first=1,last=local.length-2;
  while(first<last&&length(a,local[first])<native.size*4)first++;
  while(last>first&&length(b,local[last])<native.size*4)last--;
  const project=(p:Point)=>{const t=(support.offset-support.nx*p.xMm-support.ny*p.yMm)/(support.nx**2+support.ny**2);return {...p,id:createId(),xMm:p.xMm+support.nx*t,yMm:p.yMm+support.ny*t};},nodes=[a,project(local[first]),project(local[last]),b];
  if(Math.max(spanError(local,nodes,native.size,native.size*.1),spanError(nodes,local,native.size,native.size*.1))+native.size*.05<=native.size*1.05)return{nodes:nodes.map(p=>({...p,xMm:p.xMm+origin.xMm,yMm:p.yMm+origin.yMm})),curves:[] as Curve[]};
 }
 const nx=-(b.yMm-a.yMm)/d,ny=(b.xMm-a.xMm)/d,q={id:createId(),xMm:b.xMm+nx*reach,yMm:b.yMm+ny*reach},r={id:createId(),xMm:a.xMm+nx*reach,yMm:a.yMm+ny*reach},scaffold=[...local,q,r],forced=new Set([a.id,b.id,q.id,r.id]);
 for(const allowCurves of[true,false]){
  const fit=ring(scaffold,pixelMm,createId,allowCurves,false,false,forced,true),start=fit.nodes.findIndex(p=>p.id===a.id),end=fit.nodes.findIndex(p=>p.id===b.id);
  if(start<0||end<start)continue;
  let nodes=fit.nodes.slice(start,end+1);const ids=new Set(nodes.map(n=>n.id)),curves=fit.curves.filter(c=>ids.has(c.startNodeId)&&ids.has(c.endNodeId)),byStart=new Map(curves.map(c=>[c.startNodeId,c])),source=new Map(local.map((n,i)=>[n.id,i])),g=fit.g.size;
  // Check each supporting line against its original span after fitting joins.
  // Restore only an offending line span; retain independently valid arcs.
  for(let pass=0;pass<3;pass++){
   const bad=new Map<number,Point[]>(),anchors=new Map<string,Point>();
   for(let i=0;i+1<nodes.length;i++){
    if(byStart.has(nodes[i].id))continue;
    const from=source.get(nodes[i].id)!,to=source.get(nodes[i+1].id)!,span=local.slice(from,to+1),chord=[nodes[i],nodes[i+1]];
    if(Math.max(spanError(span,chord,g,g*.1),spanError(chord,span,g,g*.1))+g*.05<=g*1.05)continue;
    bad.set(i,span);anchors.set(span[0].id,span[0]);anchors.set(span.at(-1)!.id,span.at(-1)!);
   }
   if(!bad.size)break;
   nodes=nodes.flatMap((n,i)=>bad.has(i)?bad.get(i)!.slice(0,-1):[anchors.get(n.id)??n]);
  }
  const sampled=nodes.flatMap((n,i)=>{const c=byStart.get(n.id);return c?flatten(n,c.c1,c.c2,nodes[i+1],pixelMm/.8*.01,createId).slice(0,-1):[n];});
  // Refine sampling to .1 pixels, hence a .05-pixel Lipschitz margin.
  // Only a cubic needs the additional .01-pixel flattening margin; charging
  // that to an exact line needlessly rejects shallow digital straight spans.
  if(Math.max(spanError(local,sampled,g,g*.1),spanError(sampled,local,g,g*.1))+g*(.05+(curves.length?.01:0))>g*1.05)continue;
  const world=(p:Point)=>({...p,xMm:p.xMm+origin.xMm,yMm:p.yMm+origin.yMm});return {nodes:nodes.map(world),curves:curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};
 }
 return {nodes:points,curves:[] as Curve[]};
}
/** A closed boundary can meet another material at a single graph junction.
 * Fit that loop with the junction fixed instead of treating it as an isolated
 * ring whose phase and corner positions can move independently. */
export function recoverBoundaryLoop(points:Point[],pixelMm:number,createId:()=>string,anchors:ReadonlySet<string>){
 const origin=points[0],local=points.map(p=>({...p,xMm:p.xMm-origin.xMm,yMm:p.yMm-origin.yMm})),fit=ring(local,pixelMm,createId,true,false,false,anchors),world=(p:Point)=>({...p,xMm:p.xMm+origin.xMm,yMm:p.yMm+origin.yMm});
 return {nodes:fit.nodes.map(world),curves:fit.curves.map(c=>({...c,c1:world(c.c1),c2:world(c.c2)}))};
}
/** Deterministic sampling used by both owners when a shared boundary is a hole.
 * Hole rings are polygon-only in the saved schema, so their counterpart must
 * use exactly the same points rather than an independently flattened curve. */
export function contourPolyline(nodes:Point[],curves:Curve[],closed:boolean,tolerance:number,createId:()=>string){
 const byStart=new Map(curves.map(c=>[c.startNodeId,c]));return nodes.flatMap((n,i)=>{const c=byStart.get(n.id),b=nodes[(i+1)%nodes.length];return c?flatten(n,c.c1,c.c2,b,tolerance,createId).slice(0,-1):!closed&&i===nodes.length-1?[n]:[n];});
}
