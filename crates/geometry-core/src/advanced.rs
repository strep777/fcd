use crate::{area, distance, intersects, issue, offset_sampled, validate, validate_sampled, Geometry, Piece, Point, SAMPLED_CONTOUR_LIMIT};
use clipper2_rust::{
    difference_64, inflate_paths_64, intersect_64, union_64, xor_64, EndType, FillRule, JoinType,
    Paths64, Point64,
};
use serde::Serialize;
const SCALE: f64 = 10_000.0;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Polygon {
    pub nodes: Vec<Point>,
    pub holes: Vec<Vec<Point>>,
}
fn inside(p: &Point, ring: &[Point]) -> bool {
    let mut result = false;
    for (a, b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        if (a.y_mm > p.y_mm) != (b.y_mm > p.y_mm)
            && p.x_mm < (b.x_mm - a.x_mm) * (p.y_mm - a.y_mm) / (b.y_mm - a.y_mm) + a.x_mm
        {
            result = !result;
        }
    }
    result
}
fn touching(a: &[Point], b: &[Point]) -> bool {
    a.iter()
        .zip(a.iter().cycle().skip(1))
        .take(a.len())
        .any(|(a1, a2)| {
            b.iter()
                .zip(b.iter().cycle().skip(1))
                .take(b.len())
                .any(|(b1, b2)| intersects(a1, a2, b1, b2))
        })
}
fn normalized(mut ring: Vec<Point>, positive: bool) -> Vec<Point> {
    if (area(&ring) > 0.) != positive {
        ring.reverse();
    }
    ring
}
pub(crate) fn paths(outer: &[Point], holes: &[Vec<Point>]) -> Paths64 {
    std::iter::once(normalized(outer.to_vec(), true))
        .chain(holes.iter().map(|h| normalized(h.clone(), false)))
        .map(|r| {
            r.iter()
                .map(|p| {
                    Point64::new(
                        (p.x_mm * SCALE).round() as i64,
                        (p.y_mm * SCALE).round() as i64,
                    )
                })
                .collect()
        })
        .collect()
}
pub(crate) fn polygons(paths: Paths64) -> Result<Vec<Polygon>, &'static str> {
    polygons_with_limit(paths, false)
}
pub(crate) fn polygons_sampled(paths: Paths64) -> Result<Vec<Polygon>, &'static str> {
    polygons_with_limit(paths, true)
}
fn polygons_with_limit(paths: Paths64, sampled: bool) -> Result<Vec<Polygon>, &'static str> {
    let mut rings: Vec<Vec<Point>> = paths
        .into_iter()
        .enumerate()
        .map(|(r, path)| {
            path.into_iter()
                .enumerate()
                .map(|(i, p)| Point {
                    id: format!("00000000-0000-4000-8000-{:012x}", r * 100000 + i),
                    x_mm: p.x as f64 / SCALE,
                    y_mm: p.y as f64 / SCALE,
                })
                .collect()
        })
        .collect();
    if rings.iter().map(Vec::len).sum::<usize>() > if sampled { 24_000 } else { 20_000 } {
        return Err("nodeCount");
    }
    for ring in &mut rings {
        if sampled { validate_sampled(ring)?; } else { validate(ring)?; }
        let start = ring
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| a.x_mm.total_cmp(&b.x_mm).then(a.y_mm.total_cmp(&b.y_mm)))
            .map(|(i, _)| i)
            .ok_or("emptyResult")?;
        ring.rotate_left(start);
    }
    let mut out: Vec<Polygon> = rings
        .iter()
        .filter(|r| area(r) > 0.)
        .map(|r| Polygon {
            nodes: r.clone(),
            holes: vec![],
        })
        .collect();
    for ring in rings.into_iter().filter(|r| area(r) < 0.) {
        let index = out
            .iter()
            .enumerate()
            .filter(|(_, p)| inside(&ring[0], &p.nodes))
            .min_by(|(_, a), (_, b)| area(&a.nodes).total_cmp(&area(&b.nodes)))
            .map(|(i, _)| i)
            .ok_or("holeOutside")?;
        out[index].holes.push(ring);
    }
    out.sort_by(|a, b| {
        a.nodes[0]
            .x_mm
            .total_cmp(&b.nodes[0].x_mm)
            .then(a.nodes[0].y_mm.total_cmp(&b.nodes[0].y_mm))
    });
    Ok(out)
}
fn midpoint(a: &Point, b: &Point) -> Point {
    Point {
        id: String::new(),
        x_mm: (a.x_mm + b.x_mm) / 2.,
        y_mm: (a.y_mm + b.y_mm) / 2.,
    }
}
fn segment_distance(p: &Point, a: &Point, b: &Point) -> f64 {
    let dx = b.x_mm - a.x_mm;
    let dy = b.y_mm - a.y_mm;
    let l = dx * dx + dy * dy;
    if l == 0. {
        return distance(p, a);
    }
    let t = (((p.x_mm - a.x_mm) * dx + (p.y_mm - a.y_mm) * dy) / l).clamp(0., 1.);
    (p.x_mm - a.x_mm - t * dx).hypot(p.y_mm - a.y_mm - t * dy)
}
pub(crate) fn flatten(
    a: &Point,
    c1: &Point,
    c2: &Point,
    b: &Point,
    out: &mut Vec<Point>,
    depth: u32,
) -> Result<(), &'static str> {
    if out.len() >= 2000 {
        return Err("nodeCount");
    }
    if segment_distance(c1, a, b).max(segment_distance(c2, a, b)) <= 0.01 {
        out.push(b.clone());
        return Ok(());
    }
    if depth >= 24 {
        return Err("numericUnstable");
    }
    let p = midpoint(a, c1);
    let q = midpoint(c1, c2);
    let r = midpoint(c2, b);
    let s = midpoint(&p, &q);
    let t = midpoint(&q, &r);
    let m = midpoint(&s, &t);
    flatten(a, &p, &s, &m, out, depth + 1)?;
    flatten(&m, &t, &r, b, out, depth + 1)
}
pub fn contours(piece: &Piece) -> Result<(Vec<Point>, Vec<Vec<Point>>), &'static str> {
    crate::validate_control_nodes(&piece.nodes)?;
    let curves = piece.curves.as_deref().unwrap_or(&[]);
    if curves.len() > piece.nodes.len() {
        return Err("invalidCurve");
    }
    let mut ring = vec![];
    for (i, a) in piece.nodes.iter().enumerate() {
        let b = &piece.nodes[(i + 1) % piece.nodes.len()];
        let edge: Vec<_> = curves.iter().filter(|c| c.start_node_id == a.id).collect();
        if edge.len() > 1 {
            return Err("invalidCurve");
        }
        ring.push(a.clone());
        if let Some(c) = edge.first() {
            if c.end_node_id != b.id
                || [&c.c1, &c.c2].iter().any(|p| {
                    !p.x_mm.is_finite()
                        || !p.y_mm.is_finite()
                        || p.x_mm.abs() > 1e6
                        || p.y_mm.abs() > 1e6
                })
            {
                return Err("invalidCurve");
            }
            let mut sampled = vec![];
            flatten(a, &c.c1, &c.c2, b, &mut sampled, 0)?;
            sampled.pop();
            ring.extend(sampled);
        }
        if ring.len() > SAMPLED_CONTOUR_LIMIT {
            return Err("nodeCount");
        }
    }
    if curves
        .iter()
        .any(|c| !piece.nodes.iter().any(|n| n.id == c.start_node_id))
    {
        return Err("invalidCurve");
    }
    // Sample identifiers are derived only for computational output; original nodes retain their IDs.
    for (i, p) in ring.iter_mut().enumerate() {
        p.id = format!("00000000-0000-4000-8000-{i:012x}");
    }
    validate_sampled(&ring)?;
    let holes = piece.holes.clone().unwrap_or_default();
    if holes.len() > 32 || ring.len() + holes.iter().map(Vec::len).sum::<usize>() > 24_000 {
        return Err("nodeCount");
    }
    for (i, h) in holes.iter().enumerate() {
        validate(h)?;
        if touching(h, &ring) || !inside(&h[0], &ring) {
            return Err("holeOutside");
        }
        for other in holes.iter().skip(i + 1) {
            if touching(h, other) || inside(&h[0], other) || inside(&other[0], h) {
                return Err("holeOverlap");
            }
        }
    }
    Ok((ring, holes))
}
pub fn boolean(a: &Piece, b: &Piece, operation: &str) -> Result<Vec<Polygon>, &'static str> {
    let (ar, ah) = contours(a)?;
    let (br, bh) = contours(b)?;
    let subjects = paths(&ar, &ah);
    let clips = paths(&br, &bh);
    let output = match operation {
        "union" => union_64(&subjects, &clips, FillRule::NonZero),
        "difference" => difference_64(&subjects, &clips, FillRule::NonZero),
        "intersection" => intersect_64(&subjects, &clips, FillRule::NonZero),
        "xor" => xor_64(&subjects, &clips, FillRule::NonZero),
        _ => return Err("invalidOperation"),
    };
    polygons(output)
}
/// Compute allowances in local coordinates so display placement cannot change quantization phase.
pub fn analyze(piece: &Piece) -> Geometry {
    let Some(origin) = piece.nodes.first() else {
        return analyze_local(piece);
    };
    let inputs: Vec<&Point> = piece
        .nodes
        .iter()
        .chain(piece.holes.iter().flatten().flatten())
        .chain(piece.curves.iter().flatten().flat_map(|c| [&c.c1, &c.c2]))
        .collect();
    if inputs.iter().any(|p| {
        !p.x_mm.is_finite() || !p.y_mm.is_finite() || p.x_mm.abs() > 1e6 || p.y_mm.abs() > 1e6
    }) {
        return analyze_local(piece);
    }
    let mut ox = origin.x_mm;
    let mut oy = origin.y_mm;
    if inputs
        .iter()
        .any(|p| (p.x_mm - ox).abs() > 1e6 || (p.y_mm - oy).abs() > 1e6)
    {
        ox = (inputs.iter().map(|p| p.x_mm).fold(f64::INFINITY, f64::min)
            + inputs
                .iter()
                .map(|p| p.x_mm)
                .fold(f64::NEG_INFINITY, f64::max))
            / 2.;
        oy = (inputs.iter().map(|p| p.y_mm).fold(f64::INFINITY, f64::min)
            + inputs
                .iter()
                .map(|p| p.y_mm)
                .fold(f64::NEG_INFINITY, f64::max))
            / 2.;
    }
    let mut local = piece.clone();
    let shift = |p: &mut Point| {
        p.x_mm -= ox;
        p.y_mm -= oy;
    };
    for p in &mut local.nodes {
        shift(p);
    }
    if let Some(holes) = &mut local.holes {
        for ring in holes {
            for p in ring {
                shift(p);
            }
        }
    }
    if let Some(curves) = &mut local.curves {
        for c in curves {
            shift(&mut c.c1);
            shift(&mut c.c2);
        }
    }
    let mut result = analyze_local(&local);
    for p in result
        .cut
        .iter_mut()
        .chain(result.seam.iter_mut())
        .chain(result.cut_holes.iter_mut().flatten())
        .chain(result.seam_holes.iter_mut().flatten())
    {
        p.x_mm += ox;
        p.y_mm += oy;
    }
    for n in &mut result.notch_segments {
        n.start.x_mm += ox;
        n.start.y_mm += oy;
        n.end.x_mm += ox;
        n.end.y_mm += oy;
    }
    if result
        .cut
        .iter()
        .chain(result.cut_holes.iter().flatten())
        .any(|p| p.x_mm.abs() > 1e6 || p.y_mm.abs() > 1e6)
    {
        result.issues.push(issue(piece, "coordinateRange", "error"));
        result.cut.clear();
        result.cut_holes.clear();
    }
    result
}
fn analyze_local(piece: &Piece) -> Geometry {
    let mut result = Geometry {
        id: piece.id.clone(),
        notch_segments: vec![],
        cut: vec![],
        edge_lengths: vec![],
        seam: vec![],
        seam_holes: vec![],
        cut_holes: vec![],
        area_mm2: 0.,
        perimeter_mm: 0.,
        issues: vec![],
    };
    let mut compute = || -> Result<(), &'static str> {
        if !piece.closed {
            return Err("openPath");
        }
        if piece.cut_qty == 0
            || piece.cut_qty > 100
            || piece.material.trim().is_empty()
            || !piece.fur_rad.is_finite()
        {
            return Err("metadata");
        }
        if !piece.allowance_mm.is_finite() || !(0.0..=1000.0).contains(&piece.allowance_mm) {
            return Err("allowanceRange");
        }
        let (ring, holes) = contours(piece)?;
        result.area_mm2 = area(&ring).abs() - holes.iter().map(|h| area(h).abs()).sum::<f64>();
        result.perimeter_mm = std::iter::once(&ring)
            .chain(holes.iter())
            .map(|r| {
                r.iter()
                    .zip(r.iter().cycle().skip(1))
                    .take(r.len())
                    .map(|(a, b)| distance(a, b))
                    .sum::<f64>()
            })
            .sum();
        for (i, a) in piece.nodes.iter().enumerate() {
            let b = &piece.nodes[(i + 1) % piece.nodes.len()];
            let mut path = vec![a.clone()];
            if let Some(c) = piece
                .curves
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .find(|c| c.start_node_id == a.id)
            {
                flatten(a, &c.c1, &c.c2, b, &mut path, 0)?;
            } else {
                path.push(b.clone());
            }
            result.edge_lengths.push(crate::EdgeLength {
                node_id: a.id.clone(),
                end_node_id: b.id.clone(),
                length_mm: path.windows(2).map(|p| distance(&p[0], &p[1])).sum(),
            });
        }
        result.seam = ring.clone();
        result.seam_holes = holes.clone();
        let join = piece.join.as_deref().unwrap_or("miter");
        let limit = piece.miter_limit.unwrap_or(20.);
        if !limit.is_finite() || !(1.0..=20.0).contains(&limit) {
            return Err("miterLimit");
        }
        let jt = match join {
            "miter" => JoinType::Miter,
            "round" => JoinType::Round,
            "bevel" => JoinType::Bevel,
            _ => return Err("invalidJoin"),
        };
        if piece
            .edge_allowances
            .as_ref()
            .is_some_and(|v| !v.is_empty())
        {
            let shape = crate::allowance::cut(piece, &ring, &holes)?;
            result.cut = shape.nodes;
            result.cut_holes = shape.holes;
        } else if holes.is_empty() && join == "miter" && limit == 20. {
            result.cut = offset_sampled(&ring, piece.allowance_mm)?;
        } else if piece.allowance_mm == 0. {
            result.cut = normalized(ring.clone(), true);
            result.cut_holes = holes
                .iter()
                .cloned()
                .map(|h| normalized(h, false))
                .collect();
        } else {
            let output = inflate_paths_64(
                &paths(&ring, &holes),
                piece.allowance_mm * SCALE,
                jt,
                EndType::Polygon,
                limit,
                0.005 * SCALE,
            );
            let mut shapes = polygons_sampled(output)?;
            if shapes.is_empty() {
                return Err("emptyResult");
            }
            if shapes.len() != 1 {
                return Err("multipleContours");
            }
            let shape = shapes.remove(0);
            if shape.holes.len() != holes.len() {
                return Err("holeCollapsed");
            }
            result.cut = shape.nodes;
            result.cut_holes = shape.holes;
        }
        for n in piece.notches.as_deref().unwrap_or(&[]) {
            if !piece.nodes.iter().any(|p| p.id == n.node_id)
                || !n.position.is_finite()
                || !(0.0..=1.0).contains(&n.position)
                || !n.depth_mm.is_finite()
                || n.depth_mm <= 0.
                || n.depth_mm >= crate::allowance::width_at(piece, &n.node_id, n.position)
            {
                return Err("invalidNotch");
            }
            let path = crate::allowance::edge_path(piece, &n.node_id)?;
            let total = path.windows(2).map(|p| distance(&p[0], &p[1])).sum::<f64>();
            let mut station = n.position * total;
            let mut segment = &path[0..2];
            for w in path.windows(2) {
                segment = w;
                if station <= distance(&w[0], &w[1]) + 1e-9 {
                    break;
                }
                station -= distance(&w[0], &w[1]);
            }
            let a = &segment[0];
            let b = &segment[1];
            let length = distance(a, b);
            let x = a.x_mm + (b.x_mm - a.x_mm) * station / length;
            let y = a.y_mm + (b.y_mm - a.y_mm) * station / length;
            let sign = area(&ring).signum();
            let dx = sign * (b.y_mm - a.y_mm) / length;
            let dy = -sign * (b.x_mm - a.x_mm) / length;
            let mut travel = f64::INFINITY;
            for (p, q) in result
                .cut
                .iter()
                .zip(result.cut.iter().cycle().skip(1))
                .take(result.cut.len())
            {
                let ex = q.x_mm - p.x_mm;
                let ey = q.y_mm - p.y_mm;
                let den = dx * ey - dy * ex;
                if den.abs() < 1e-12 {
                    continue;
                }
                let t = ((p.x_mm - x) * ey - (p.y_mm - y) * ex) / den;
                let u = ((p.x_mm - x) * dy - (p.y_mm - y) * dx) / den;
                if t >= -1e-9 && (-1e-9..=1. + 1e-9).contains(&u) {
                    travel = travel.min(t);
                }
            }
            if !travel.is_finite() || travel <= n.depth_mm {
                return Err("invalidNotch");
            }
            result.notch_segments.push(crate::NotchSegment {
                id: n.id.clone(),
                start: Point {
                    id: n.id.clone(),
                    x_mm: x + dx * travel,
                    y_mm: y + dy * travel,
                },
                end: Point {
                    id: n.id.clone(),
                    x_mm: x + dx * (travel - n.depth_mm),
                    y_mm: y + dy * (travel - n.depth_mm),
                },
                label: n.label.clone(),
            });
        }
        Ok(())
    };
    if let Err(e) = compute() {
        result.issues.push(issue(piece, e, "error"));
        return result;
    }
    if result.area_mm2 < 25. {
        result.issues.push(issue(piece, "smallArea", "warning"));
    }
    let ring = &result.seam;
    let min_x = ring.iter().map(|p| p.x_mm).fold(f64::INFINITY, f64::min);
    let max_x = ring
        .iter()
        .map(|p| p.x_mm)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = ring.iter().map(|p| p.y_mm).fold(f64::INFINITY, f64::min);
    let max_y = ring
        .iter()
        .map(|p| p.y_mm)
        .fold(f64::NEG_INFINITY, f64::max);
    if (max_x - min_x).min(max_y - min_y) < 2. {
        result.issues.push(issue(piece, "narrowPiece", "warning"));
    }
    result
}
