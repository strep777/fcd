use serde::{Deserialize, Serialize};

include!("schema_generated.rs");
mod advanced;
mod allowance;
#[cfg(test)]
mod contour_budget_tests;
#[cfg(test)]
mod numerical_contour_tests;
mod arap;
mod numerical;
pub mod clipping;
pub mod surface;
pub use advanced::{analyze, boolean};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub rule_id: String,
    pub severity: String,
    pub entity_id: String,
    pub message_key: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeLength {
    pub node_id: String,
    pub end_node_id: String,
    pub length_mm: f64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchSegment {
    pub id: String,
    pub start: Point,
    pub end: Point,
    pub label: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub notch_segments: Vec<NotchSegment>,
    pub id: String,
    pub cut: Vec<Point>,
    pub edge_lengths: Vec<EdgeLength>,
    pub seam: Vec<Point>,
    pub seam_holes: Vec<Vec<Point>>,
    pub cut_holes: Vec<Vec<Point>>,
    pub area_mm2: f64,
    pub perimeter_mm: f64,
    pub issues: Vec<Issue>,
}

fn cross(a: &Point, b: &Point, c: &Point) -> f64 {
    (b.x_mm - a.x_mm) * (c.y_mm - a.y_mm) - (b.y_mm - a.y_mm) * (c.x_mm - a.x_mm)
}
pub fn area(p: &[Point]) -> f64 {
    if p.len() < 3 {
        return 0.0;
    }
    // Laid-out patterns can be far from the origin while containing tiny
    // positive-area details. Translate first to avoid cancelling large terms.
    let origin = &p[0];
    p.iter()
        .zip(p.iter().cycle().skip(1))
        .take(p.len())
        .map(|(a, b)| (a.x_mm - origin.x_mm) * (b.y_mm - origin.y_mm)
            - (b.x_mm - origin.x_mm) * (a.y_mm - origin.y_mm))
        .sum::<f64>()
        / 2.0
}
fn distance(a: &Point, b: &Point) -> f64 {
    (a.x_mm - b.x_mm).hypot(a.y_mm - b.y_mm)
}
fn on_segment(a: &Point, b: &Point, c: &Point) -> bool {
    // The tolerance is a distance in mm, not a cross-product area. A fixed
    // area threshold falsely joins disjoint short edges on detailed inserts.
    cross(a, b, c).abs() <= 1e-6 * distance(a, b)
        && c.x_mm >= a.x_mm.min(b.x_mm) - 1e-6
        && c.x_mm <= a.x_mm.max(b.x_mm) + 1e-6
        && c.y_mm >= a.y_mm.min(b.y_mm) - 1e-6
        && c.y_mm <= a.y_mm.max(b.y_mm) + 1e-6
}
fn intersects(a: &Point, b: &Point, c: &Point, d: &Point) -> bool {
    let (ab_c, ab_d, cd_a, cd_b) = (
        cross(a, b, c),
        cross(a, b, d),
        cross(c, d, a),
        cross(c, d, b),
    );
    (ab_c * ab_d < 0.0 && cd_a * cd_b < 0.0)
        || on_segment(a, b, c)
        || on_segment(a, b, d)
        || on_segment(c, d, a)
        || on_segment(c, d, b)
}
pub fn validate(p: &[Point]) -> Result<(), &'static str> {
    validate_with_limit(p, 2000)
}
// Editable anchors and derived 0.01 mm curve samples have different budgets.
// Keep the external node limit unchanged, including Boolean/editing output.
pub(crate) const SAMPLED_CONTOUR_LIMIT: usize = 12_000;
pub(crate) fn validate_sampled(p: &[Point]) -> Result<(), &'static str> {
    validate_with_limit(p, SAMPLED_CONTOUR_LIMIT)
}
fn reliable_nonzero_area(p: &[Point]) -> bool {
    let origin = [p[0].x_mm, p[0].y_mm];
    let mut error = 0.;
    let mut absolute_terms = 0.;
    for i in 1..p.len() - 1 {
        let Some((det, bound)) = numerical::determinant(
            origin, [p[i].x_mm, p[i].y_mm], [p[i + 1].x_mm, p[i + 1].y_mm],
        ) else { return false; };
        error += bound;
        absolute_terms += det.abs();
    }
    // A physical area cutoff rejects reliable, slender material domains.
    // Account for fan cancellation and summation error instead; short edges,
    // crossings and allowance validity are still checked independently.
    error += f64::EPSILON * (p.len() as f64 + 2.) * absolute_terms;
    let twice_area = 2. * area(p).abs();
    twice_area.is_finite() && twice_area > error
}
// Anchor chords are not the boundary of a Bézier contour. Check editable
// coordinates and identifiers here; check topology on the sampled boundary.
pub(crate) fn validate_control_nodes(p: &[Point]) -> Result<(), &'static str> {
    validate_node_attributes(p, 2000)
}
fn validate_node_attributes(p: &[Point], limit: usize) -> Result<(), &'static str> {
    if p.len() < 3 || p.len() > limit {
        return Err("nodeCount");
    }
    if p.iter().any(|v| {
        !v.x_mm.is_finite() || !v.y_mm.is_finite() || v.x_mm.abs() > 1e6 || v.y_mm.abs() > 1e6
    }) {
        return Err("coordinateRange");
    }
    let mut ids = std::collections::HashSet::with_capacity(p.len());
    for i in 0..p.len() {
        if distance(&p[i], &p[(i + 1) % p.len()]) < 1e-6 {
            return Err("shortEdge");
        }
        if !ids.insert(&p[i].id) {
            return Err("duplicateNode");
        }
    }
    Ok(())
}
fn validate_with_limit(p: &[Point], limit: usize) -> Result<(), &'static str> {
    validate_node_attributes(p, limit)?;
    // Broad-phase bounds avoid comparing every dense curve sample with every
    // other sample. The exact intersection predicate and its tolerance stay.
    let mut boxes: Vec<_> = p.iter().enumerate().map(|(i, a)| {
        let b = &p[(i + 1) % p.len()];
        (i, a.x_mm.min(b.x_mm), a.y_mm.min(b.y_mm), a.x_mm.max(b.x_mm), a.y_mm.max(b.y_mm))
    }).collect();
    boxes.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
    for (k, a) in boxes.iter().enumerate() {
        for b in boxes.iter().skip(k + 1) {
            if b.1 > a.3 + 1e-6 {
                break;
            }
            if b.2 > a.4 + 1e-6 || a.2 > b.4 + 1e-6 {
                continue;
            }
            let (i, j) = (a.0, b.0);
            if (i + 1) % p.len() == j || (j + 1) % p.len() == i {
                continue;
            }
            if intersects(&p[i], &p[(i + 1) % p.len()], &p[j], &p[(j + 1) % p.len()]) {
                return Err("selfIntersection");
            }
        }
    }
    if !reliable_nonzero_area(p) {
        return Err("degenerate");
    }
    Ok(())
}
pub fn offset(p: &[Point], width: f64) -> Result<Vec<Point>, &'static str> {
    offset_with_limit(p, width, 2000)
}
pub(crate) fn offset_sampled(p: &[Point], width: f64) -> Result<Vec<Point>, &'static str> {
    offset_with_limit(p, width, SAMPLED_CONTOUR_LIMIT)
}
fn offset_with_limit(p: &[Point], width: f64, limit: usize) -> Result<Vec<Point>, &'static str> {
    validate_with_limit(p, limit)?;
    if !width.is_finite() || !(0.0..=1000.0).contains(&width) {
        return Err("allowanceRange");
    }
    let mut ring = p.to_vec();
    if area(&ring) < 0.0 {
        ring.reverse();
    }
    if width == 0.0 {
        return Ok(ring);
    }
    let n = ring.len();
    if (0..n).any(|i| cross(&ring[i], &ring[(i + 1) % n], &ring[(i + 2) % n]) <= 1e-6) {
        return offset_concave(&ring, width, limit);
    }
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let (prev, cur, next) = (&ring[(i + n - 1) % n], &ring[i], &ring[(i + 1) % n]);
        let (la, lb) = (distance(prev, cur), distance(cur, next));
        let (ax, ay) = ((cur.x_mm - prev.x_mm) / la, (cur.y_mm - prev.y_mm) / la);
        let (bx, by) = ((next.x_mm - cur.x_mm) / lb, (next.y_mm - cur.y_mm) / lb);
        let (px, py) = (cur.x_mm + ay * width, cur.y_mm - ax * width);
        let (qx, qy) = (cur.x_mm + by * width, cur.y_mm - bx * width);
        let denom = ax * by - ay * bx;
        if denom.abs() < 1e-12 {
            return Err("numericUnstable");
        }
        let t = ((qx - px) * by - (qy - py) * bx) / denom;
        let v = Point {
            id: cur.id.clone(),
            x_mm: px + t * ax,
            y_mm: py + t * ay,
        };
        if distance(cur, &v) > width * 20.0 {
            return Err("miterLimit");
        }
        out.push(v);
    }
    validate_with_limit(&out, limit)?;
    Ok(out)
}
fn offset_concave(ring: &[Point], width: f64, limit: usize) -> Result<Vec<Point>, &'static str> {
    use clipper2_rust::{inflate_paths_64, EndType, JoinType, Point64};
    const SCALE: f64 = 10_000.0;
    let path: Vec<Point64> = ring
        .iter()
        .map(|p| {
            Point64::new(
                (p.x_mm * SCALE).round() as i64,
                (p.y_mm * SCALE).round() as i64,
            )
        })
        .collect();
    let output = inflate_paths_64(
        &vec![path],
        width * SCALE,
        JoinType::Miter,
        EndType::Polygon,
        20.0,
        0.01 * SCALE,
    );
    if output.is_empty() {
        return Err("emptyResult");
    }
    if output.len() != 1 {
        return Err("multipleContours");
    }
    let mut points: Vec<Point> = output[0]
        .iter()
        .enumerate()
        .map(|(i, p)| Point {
            id: format!("00000000-0000-4000-8000-{i:012x}"),
            x_mm: p.x as f64 / SCALE,
            y_mm: p.y as f64 / SCALE,
        })
        .collect();
    if area(&points) < 0.0 {
        points.reverse();
    }
    // A canonical starting vertex makes the output independent of backend ring rotation.
    let start = points
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.x_mm.total_cmp(&b.x_mm).then(a.y_mm.total_cmp(&b.y_mm)))
        .map(|(i, _)| i)
        .ok_or("emptyResult")?;
    points.rotate_left(start);
    for (i, p) in points.iter_mut().enumerate() {
        p.id = format!("00000000-0000-4000-8000-{i:012x}");
    }
    validate_with_limit(&points, limit)?;
    Ok(points)
}
fn issue(p: &Piece, key: &str, severity: &str) -> Issue {
    Issue {
        rule_id: format!("{}:{}", p.id, key),
        entity_id: p.id.clone(),
        severity: severity.into(),
        message_key: key.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn points(coords: &[(f64, f64)]) -> Vec<Point> {
        coords
            .iter()
            .enumerate()
            .map(|(i, (x, y))| Point {
                id: i.to_string(),
                x_mm: *x,
                y_mm: *y,
            })
            .collect()
    }
    #[test]
    fn rectangle_offset_oracle() {
        let p = points(&[(0., 0.), (100., 0.), (100., 200.), (0., 200.)]);
        let c = offset(&p, 10.).unwrap();
        assert_eq!(area(&p), 20000.);
        assert_eq!(area(&c), 26400.);
        assert_eq!((c[0].x_mm, c[0].y_mm), (-10., -10.));
        assert_eq!((c[2].x_mm, c[2].y_mm), (110., 210.));
    }
    #[test]
    fn reject_self_intersection() {
        assert_eq!(
            validate(&points(&[(0., 0.), (10., 10.), (0., 10.), (10., 0.)])),
            Err("selfIntersection")
        );
    }
    #[test]
    fn short_separate_edges_are_not_false_intersections_at_large_coordinates() {
        let original = [
            (2046.101467205625, 2076.4321481585416),
            (2046.101467205625, 2076.4323776685414),
            (2046.0980573286251, 2076.4294690595416),
            (2046.0980573286251, 2076.4289813475416),
        ];
        for shift in [0., -2000., 500_000.] {
            let moved: Vec<_> = original.iter().map(|(x, y)| (x + shift, y + shift)).collect();
            let p = points(&moved);
            assert_eq!(validate(&p), Ok(()), "shift {shift}");
            assert!(area(&p) > 1e-6);
        }
    }
    #[test]
    fn segment_contact_uses_the_same_distance_budget_for_short_and_long_edges() {
        for length in [0.001, 1., 10_000.] {
            let p = points(&[(0., 0.), (length, 0.), (length / 2., 0.00005), (length, 0.00005)]);
            assert!(!intersects(&p[0], &p[1], &p[2], &p[3]));
            let contact = points(&[(0., 0.), (length, 0.), (length / 2., 0.), (length / 2., 1.)]);
            assert!(intersects(&contact[0], &contact[1], &contact[2], &contact[3]));
            let crossing = points(&[(0., 0.), (length, 0.), (length / 2., -0.00005), (length / 2., 0.00005)]);
            assert!(intersects(&crossing[0], &crossing[1], &crossing[2], &crossing[3]));
        }
    }
    #[test]
    fn reject_nonfinite() {
        assert!(validate(&points(&[(0., 0.), (f64::NAN, 10.), (10., 0.)])).is_err());
    }
    #[test]
    fn clockwise_is_normalized() {
        let p = points(&[(0., 0.), (0., 200.), (100., 200.), (100., 0.)]);
        assert_eq!(area(&offset(&p, 10.).unwrap()), 26400.);
    }
    #[test]
    fn concave_offset_oracle_and_orientation() {
        let p = points(&[
            (0., 0.),
            (100., 0.),
            (100., 40.),
            (40., 40.),
            (40., 100.),
            (0., 100.),
        ]);
        let c = offset(&p, 10.).unwrap();
        assert_eq!(area(&p), 6400.);
        assert_eq!(area(&c), 10800.);
        assert_eq!(
            c.iter().map(|p| (p.x_mm, p.y_mm)).collect::<Vec<_>>(),
            vec![
                (-10., -10.),
                (110., -10.),
                (110., 50.),
                (50., 50.),
                (50., 110.),
                (-10., 110.)
            ]
        );
        let mut reverse = p.clone();
        reverse.reverse();
        assert_eq!(
            serde_json::to_string(&c).unwrap(),
            serde_json::to_string(&offset(&reverse, 10.).unwrap()).unwrap()
        );
        assert_eq!(area(&offset(&p, 0.).unwrap()), 6400.);
    }
    #[test]
    fn f64_roundtrip() {
        let p = points(&[(0.00001, 0.), (100.123456789, 0.), (100., 200.)]);
        let s = serde_json::to_string(&p).unwrap();
        let q: Vec<Point> = serde_json::from_str(&s).unwrap();
        assert_eq!(p[1].x_mm, q[1].x_mm);
    }
}
