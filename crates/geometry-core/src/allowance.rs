//! Piecewise linear allowances in normalized arc length. A continuous offset
//! envelope avoids cracks at sampled joins; inward hole strips are subtracted.
use crate::advanced::{flatten, paths, polygons_sampled as polygons};
use crate::{area, distance, EdgeAllowance, Piece, Point};
use clipper2_rust::{difference_64, trim_collinear_64, union_64, FillRule, Paths64};

pub(crate) fn edge_path(piece: &Piece, node_id: &str) -> Result<Vec<Point>, &'static str> {
    let ring = std::iter::once(&piece.nodes)
        .chain(piece.holes.as_deref().unwrap_or(&[]).iter())
        .find(|r| r.iter().any(|p| p.id == node_id))
        .ok_or("invalidAllowanceEdge")?;
    let i = ring
        .iter()
        .position(|p| p.id == node_id)
        .ok_or("invalidAllowanceEdge")?;
    let a = &ring[i];
    let b = &ring[(i + 1) % ring.len()];
    let mut path = vec![a.clone()];
    if let Some(c) = piece
        .curves
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .find(|c| c.start_node_id == node_id)
    {
        flatten(a, &c.c1, &c.c2, b, &mut path, 0)?;
    } else {
        path.push(b.clone());
    }
    Ok(path)
}
pub(crate) fn profile<'a>(piece: &'a Piece, node_id: &str) -> Option<&'a EdgeAllowance> {
    piece
        .edge_allowances
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .find(|e| e.node_id == node_id)
}
pub(crate) fn width_at(piece: &Piece, node_id: &str, s: f64) -> f64 {
    let Some(edge) = profile(piece, node_id) else {
        return piece.allowance_mm;
    };
    let samples = &edge.samples;
    for w in samples.windows(2) {
        if s <= w[1].s {
            return w[0].width_mm
                + (w[1].width_mm - w[0].width_mm) * (s - w[0].s) / (w[1].s - w[0].s);
        }
    }
    samples.last().map_or(piece.allowance_mm, |v| v.width_mm)
}
pub(crate) fn validate_profiles(piece: &Piece) -> Result<(), &'static str> {
    let mut seen = std::collections::BTreeSet::new();
    for e in piece.edge_allowances.as_deref().unwrap_or(&[]) {
        if !seen.insert(&e.node_id)
            || e.samples.len() < 2
            || e.samples.len() > 64
            || e.samples.first().is_none_or(|p| p.s != 0.)
            || e.samples.last().is_none_or(|p| p.s != 1.)
            || e.samples.iter().any(|p| {
                !p.s.is_finite() || !p.width_mm.is_finite() || !(0.0..=1000.).contains(&p.width_mm)
            })
            || e.samples.windows(2).any(|w| w[1].s <= w[0].s)
        {
            return Err("invalidAllowanceProfile");
        }
        let path = edge_path(piece, &e.node_id)?;
        if path.last().is_none_or(|p| p.id != e.end_node_id) {
            return Err("invalidAllowanceEdge");
        }
    }
    Ok(())
}
fn point(x: f64, y: f64) -> Point {
    Point {
        id: String::new(),
        x_mm: x,
        y_mm: y,
    }
}
fn ring_envelope(piece: &Piece, ring: &[Point], hole: bool) -> Result<Paths64, &'static str> {
    let sign = area(ring).signum() * if hole { -1. } else { 1. };
    let mut boundary = vec![];
    let mut strips = vec![];
    let mut segments: Vec<(Point, Point, Point, Point)> = vec![];
    for a in ring {
        let path = edge_path(piece, &a.id)?;
        let mut distances = vec![0.];
        for w in path.windows(2) {
            distances.push(distances.last().copied().unwrap_or(0.) + distance(&w[0], &w[1]));
        }
        let length = *distances.last().ok_or("shortEdge")?;
        if length < 1e-6 {
            return Err("shortEdge");
        }
        let mut stations = distances.clone();
        if let Some(e) = profile(piece, &a.id) {
            stations.extend(e.samples.iter().map(|v| v.s * length));
        }
        stations.sort_by(f64::total_cmp);
        stations.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        let sample = |s: f64| {
            let i = distances
                .windows(2)
                .position(|w| s <= w[1] + 1e-9)
                .unwrap_or(path.len() - 2);
            let t = ((s - distances[i]) / (distances[i + 1] - distances[i])).clamp(0., 1.);
            point(
                path[i].x_mm + (path[i + 1].x_mm - path[i].x_mm) * t,
                path[i].y_mm + (path[i + 1].y_mm - path[i].y_mm) * t,
            )
        };
        for w in stations.windows(2) {
            let a0 = sample(w[0]);
            let b0 = sample(w[1]);
            let l = distance(&a0, &b0);
            if l < 1e-9 {
                continue;
            }
            let nx = sign * (b0.y_mm - a0.y_mm) / l;
            let ny = -sign * (b0.x_mm - a0.x_mm) / l;
            let wa = width_at(piece, &a.id, w[0] / length);
            let wb = width_at(piece, &a.id, w[1] / length);
            let oa = point(a0.x_mm + nx * wa, a0.y_mm + ny * wa);
            let ob = point(b0.x_mm + nx * wb, b0.y_mm + ny * wb);
            if hole {
                let quad = vec![a0.clone(), b0.clone(), ob.clone(), oa.clone()];
                if area(&quad).abs() > 1e-8 {
                    strips.extend(paths(&quad, &[]));
                }
            }
            segments.push((a0, b0, oa, ob));
            if segments.len() * 4 > 100_000 {
                return Err("nodeCount");
            }
        }
    }
    for i in 0..segments.len() {
        let (a, c, _oa, u) = &segments[i];
        let (_, b, v, _ob) = &segments[(i + 1) % segments.len()];
        let dx = c.x_mm - a.x_mm;
        let dy = c.y_mm - a.y_mm;
        let ex = b.x_mm - c.x_mm;
        let ey = b.y_mm - c.y_mm;
        let turn = (dx * ey - dy * ex) * sign;
        if turn < -1e-10 {
            let den = dx * ey - dy * ex;
            let t = ((v.x_mm - u.x_mm) * ey - (v.y_mm - u.y_mm) * ex) / den;
            let m = point(u.x_mm + t * dx, u.y_mm + t * dy);
            if distance(c, &m)
                > distance(c, u).max(distance(c, v)) * piece.miter_limit.unwrap_or(20.) + 1e-7
            {
                return Err("miterLimit");
            }
            boundary.push(m);
            continue;
        }
        if turn <= 1e-10 {
            boundary.push(u.clone());
            boundary.push(v.clone());
            continue;
        }
        let mut wedge = vec![u.clone()];
        let ru = distance(c, u);
        let rv = distance(c, v);
        match piece.join.as_deref().unwrap_or("miter") {
            "miter" => {
                let ux = dx;
                let uy = dy;
                let vx = ex;
                let vy = ey;
                let den = ux * vy - uy * vx;
                if den.abs() < 1e-12 {
                    return Err("numericUnstable");
                }
                let t = ((v.x_mm - u.x_mm) * vy - (v.y_mm - u.y_mm) * vx) / den;
                let m = point(u.x_mm + t * ux, u.y_mm + t * uy);
                if distance(c, &m) > ru.max(rv) * piece.miter_limit.unwrap_or(20.) + 1e-7 {
                    return Err("miterLimit");
                }
                // Unequal widths can make the local offset lines meet behind the incoming
                // segment. Such a reversed miter creates a self-crossing wedge.
                // Use the bevel envelope in this case; never union an inverted join.
                let q = ((v.x_mm - u.x_mm) * uy - (v.y_mm - u.y_mm) * ux) / den;
                if t >= -1e-9 && q <= 1e-9 {
                    wedge.push(m);
                }
            }
            "round" => {
                let start = (u.y_mm - c.y_mm).atan2(u.x_mm - c.x_mm);
                let end = (v.y_mm - c.y_mm).atan2(v.x_mm - c.x_mm);
                let theta = if sign > 0. {
                    (end - start).rem_euclid(2. * std::f64::consts::PI)
                } else {
                    -((start - end).rem_euclid(2. * std::f64::consts::PI))
                };
                let steps =
                    ((theta.abs() * (ru.max(rv) / 0.005).sqrt()).ceil() as usize).clamp(1, 4096);
                for j in 1..steps {
                    let t = j as f64 / steps as f64;
                    let radius = ru + (rv - ru) * t;
                    let angle = start + theta * t;
                    wedge.push(point(
                        c.x_mm + radius * angle.cos(),
                        c.y_mm + radius * angle.sin(),
                    ));
                }
            }
            "bevel" => {}
            _ => return Err("invalidJoin"),
        }
        wedge.push(v.clone());
        if hole {
            let mut filled = vec![c.clone()];
            filled.extend(wedge.clone());
            if area(&filled).abs() > 1e-8 {
                strips.extend(paths(&filled, &[]));
            }
        }
        boundary.extend(wedge);
        if boundary.len() > 100_000 {
            return Err("nodeCount");
        }
    }
    Ok(if hole { strips } else { paths(&boundary, &[]) })
}
pub(crate) fn cut(
    piece: &Piece,
    ring: &[Point],
    holes: &[Vec<Point>],
) -> Result<crate::advanced::Polygon, &'static str> {
    validate_profiles(piece)?;
    let mut subjects = paths(ring, &[]);
    subjects.extend(ring_envelope(piece, &piece.nodes, false)?);
    let mut outer = union_64(&subjects, &vec![], FillRule::NonZero);
    for hole in holes {
        let inset = difference_64(
            &paths(hole, &[]),
            &ring_envelope(piece, hole, true)?,
            FillRule::NonZero,
        );
        if inset.is_empty() {
            return Err("holeCollapsed");
        }
        if polygons(inset.iter().map(|r| trim_collinear_64(r, false)).collect())?.len() != 1 {
            return Err("multipleContours");
        }
        outer = difference_64(&outer, &inset, FillRule::NonZero);
    }
    let mut shapes = polygons(outer.iter().map(|r| trim_collinear_64(r, false)).collect())?;
    if shapes.len() != 1 {
        return Err("multipleContours");
    }
    let shape = shapes.remove(0);
    if shape.holes.len() != holes.len() {
        return Err("holeCollapsed");
    }
    Ok(shape)
}
