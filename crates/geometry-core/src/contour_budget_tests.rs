use crate::{analyze, validate, Piece, Point};
use serde_json::json;

fn circle(radius: f64, allowance: f64) -> Piece {
    let count = 16;
    let step = std::f64::consts::TAU / count as f64;
    let handle = 4. / 3. * (step / 4.).tan() * radius;
    let point = |index: usize, angle: f64| json!({
        "id": format!("point-{index}"), "xMm": radius * angle.cos(), "yMm": radius * angle.sin()
    });
    let nodes: Vec<_> = (0..count).map(|i| point(i, i as f64 * step)).collect();
    let curves: Vec<_> = (0..count).map(|i| {
        let a = i as f64 * step;
        let b = (i + 1) as f64 * step;
        json!({"id": format!("curve-{i}"), "startNodeId": format!("point-{i}"),
            "endNodeId": format!("point-{}", (i + 1) % count),
            "c1": {"id": format!("handle-{i}-a"), "xMm": radius*a.cos()-handle*a.sin(), "yMm": radius*a.sin()+handle*a.cos()},
            "c2": {"id": format!("handle-{i}-b"), "xMm": radius*b.cos()+handle*b.sin(), "yMm": radius*b.sin()-handle*b.cos()}})
    }).collect();
    serde_json::from_value(json!({"id":"circle", "name":"Curved reference", "nodes":nodes,
        "curves":curves, "closed":true, "allowanceMm":allowance, "cutQty":1, "mirror":false,
        "material":"fur", "furRad":0, "color":"#ffcc22"})).unwrap()
}

#[test]
fn few_control_nodes_can_require_more_than_two_thousand_precision_samples() {
    for allowance in [0., 10.] {
        let piece = circle(20_000., allowance);
        let geometry = analyze(&piece);
        assert!(geometry.issues.iter().all(|i| i.severity != "error"), "{:?}", geometry.issues);
        assert!(geometry.seam.len() > 2000);
        assert!(geometry.cut.len() > 2000);
        let area = std::f64::consts::PI * 20_000_f64.powi(2);
        assert!((geometry.area_mm2 - area).abs() / area < 0.0001);
        assert_eq!(piece.nodes.len(), 16);
        // These are generated measurement samples, not new editable anchors.
        assert_eq!(validate(&geometry.seam), Err("nodeCount"));
    }
}

#[test]
fn excessive_derived_sampling_still_has_a_finite_budget() {
    let geometry = analyze(&circle(950_000., 0.));
    assert!(geometry.issues.iter().any(|i| i.message_key == "nodeCount"));
}

#[test]
fn editable_geometry_keeps_the_existing_two_thousand_node_limit() {
    let nodes: Vec<Point> = (0..2001).map(|i| {
        let angle = i as f64 * std::f64::consts::TAU / 2001.;
        Point {id: format!("{i}"), x_mm: angle.cos()*100., y_mm: angle.sin()*100.}
    }).collect();
    assert_eq!(validate(&nodes), Err("nodeCount"));
}

#[test]
fn derived_contours_still_reject_crossings_and_duplicate_identifiers() {
    let nodes: Vec<Point> = (0..2500).map(|i| {
        let angle = i as f64 * std::f64::consts::TAU / 2500.;
        Point {id: format!("{i}"), x_mm: angle.cos()*100., y_mm: angle.sin()*100.}
    }).collect();
    assert_eq!(crate::validate_sampled(&nodes), Ok(()));
    let mut crossed = nodes.clone();
    crossed.swap(100, 1300);
    assert_eq!(crate::validate_sampled(&crossed), Err("selfIntersection"));
    let mut duplicate = nodes;
    duplicate[100].id = duplicate[1300].id.clone();
    assert_eq!(crate::validate_sampled(&duplicate), Err("duplicateNode"));
}

#[test]
fn curved_boundary_is_validated_instead_of_its_crossing_anchor_chords() {
    let mut piece: Piece = serde_json::from_value(json!({
        "id":"curved", "name":"Simple curved boundary", "closed":true,
        "allowanceMm":0, "cutQty":1, "mirror":false, "material":"fur", "furRad":0, "color":"#ffcc22",
        "nodes":[
            {"id":"a","xMm":0,"yMm":0}, {"id":"b","xMm":2,"yMm":2},
            {"id":"c","xMm":0,"yMm":2}, {"id":"d","xMm":2,"yMm":0}
        ],
        "curves":[{"id":"arc", "startNodeId":"c", "endNodeId":"d",
            "c1":{"id":"h1","xMm":-4,"yMm":2},
            "c2":{"id":"h2","xMm":-4,"yMm":-4}}]
    })).unwrap();
    assert_eq!(validate(&piece.nodes), Err("selfIntersection"));
    let geometry = analyze(&piece);
    assert!(geometry.issues.iter().all(|i| i.severity != "error"), "{:?}", geometry.issues);
    assert!(geometry.area_mm2 > 1.);
    // Removing the arc makes the actual contour cross. It is still rejected.
    piece.curves = None;
    assert!(analyze(&piece).issues.iter().any(|i| i.message_key == "selfIntersection"));
    piece.nodes[1].id = piece.nodes[0].id.clone();
    assert!(analyze(&piece).issues.iter().any(|i| i.message_key == "duplicateNode"));
}
