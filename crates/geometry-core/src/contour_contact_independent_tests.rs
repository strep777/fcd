//! Independent functional regressions for contact classification. All values
//! are millimetres; the editable short-edge limit remains 1e-6 mm.
use super::*;

fn points(coords: &[(f64, f64)]) -> Vec<Point> {
    coords.iter().enumerate().map(|(i, &(x_mm, y_mm))| Point {
        id: i.to_string(), x_mm, y_mm,
    }).collect()
}

#[test]
fn resolvable_short_corner_is_not_contact_after_translation_scaling_or_reversal() {
    let original = [
        (1.1034437149153753, 3.384558002857238),
        (0., 6.818802642819924),
        (6.827837243622698, 11.42856749329866),
        (1.1034442673017466, 3.3845590601942757),
    ];
    for scale in [1., 10., 1000.] {
        for shift in [0., 1000., 500_000.] {
            let mut p = points(&original.map(|(x, y)| (x * scale + shift, y * scale + shift)));
            for _ in 0..2 {
                assert!(!intersects(&p[0], &p[1], &p[2], &p[3]), "scale {scale}, shift {shift}");
                assert_eq!(validate(&p), Ok(()), "scale {scale}, shift {shift}");
                p.reverse();
            }
        }
    }
    let below_limit = points(&original.map(|(x, y)| (x * 0.1, y * 0.1)));
    assert_eq!(validate(&below_limit), Err("shortEdge"));
}

#[test]
fn crossing_collinear_overlap_and_endpoint_contacts_remain_intersections() {
    let cases = [
        [(0., 0.), (10., 0.), (5., -1.), (5., 1.)],
        [(0., 0.), (10., 0.), (5., 0.), (15., 0.)],
        [(0., 0.), (10., 0.), (10., 0.), (10., 10.)],
        [(0., 0.), (10., 0.), (5., 0.), (5., 10.)],
    ];
    for coordinates in cases {
        for scale in [0.001, 1., 1000.] {
            for shift in [0., 1000., 500_000.] {
                let p = points(&coordinates.map(|(x, y)| (x * scale + shift, y * scale + shift)));
                assert!(intersects(&p[0], &p[1], &p[2], &p[3]));
                assert!(intersects(&p[3], &p[2], &p[1], &p[0]));
            }
        }
    }
    let separated = points(&[(0., 0.), (10., 0.), (10.0000001, 0.), (20., 0.)]);
    assert!(!intersects(&separated[0], &separated[1], &separated[2], &separated[3]));
}

#[test]
fn repeated_nonadjacent_contact_is_rejected_but_nearby_disjoint_edges_are_valid() {
    let touching = points(&[(0.,0.),(10.,0.),(10.,10.),(5.,0.),(0.,10.)]);
    assert_eq!(validate(&touching), Err("selfIntersection"));
    let crossing = points(&[(0.,0.),(10.,10.),(0.,10.),(10.,0.)]);
    assert_eq!(validate(&crossing), Err("selfIntersection"));
    let disjoint = points(&[(0.,0.),(10.,0.),(10.,10.),(5.,0.0000001),(0.,10.)]);
    assert_eq!(validate(&disjoint), Ok(()));
}

fn captured_23_point_outline() -> Vec<Point> {
    // Actual arm-left /59+/60 native ARAP-seamed output, unmodified node order.
    // Source: arm-left-59-60-native-diagnostic-run2.json trace[5].response.patches[0].
    points(&[
        (1.1034437149153753,3.384558002857238), (0.,6.818802642819924),
        (0.17727578712532654,5.138770689887638), (0.3191623329694213,3.794112317791363),
        (0.3328118579246908,3.6647495096823555), (0.45216957264496216,2.7548153585291466),
        (0.5762682148592226,1.8083734730036838), (0.7855752091915917,0.1994531122971761),
        (2.874703879562877,0.10638546223245449), (7.501122819607667,0.042483768515610976),
        (9.768598484629518,0.011156367730725592), (10.570715905096655,0.),
        (11.147679951204505,0.015258860136412977), (11.085438032266804,0.49142955310855285),
        (11.036869322170919,0.8802908259996833), (10.946305017388255,1.4968794995990624),
        (10.827078040841343,2.313512154460984), (10.534228265455425,4.319330044294196),
        (10.407729402809608,5.185684465466787), (10.160524042285228,6.87890959377382),
        (9.105810022366999,14.103084144392144), (6.827837243622698,11.42856749329866),
        (1.1034442673017466,3.3845590601942757),
    ])
}

#[test]
fn actual_23_point_native_outline_and_ten_mm_allowance_remain_valid() {
    let p = captured_23_point_outline();
    assert_eq!(p.len(), 23);
    assert_eq!(validate(&p), Ok(()));
    let original = serde_json::to_string(&p).unwrap();
    let cut = offset(&p, 10.).unwrap();
    assert_eq!(validate(&cut), Ok(()));
    assert!(area(&cut).abs() > area(&p).abs());
    assert_eq!(serde_json::to_string(&p).unwrap(), original);
    for allowance in [0., 10.] {
        let piece: Piece = serde_json::from_value(serde_json::json!({
            "id":"captured-arm", "name":"Actual retained short corner",
            "nodes":p, "closed":true, "allowanceMm":allowance, "join":"round",
            "cutQty":1, "mirror":false, "material":"Fabric", "furRad":0., "color":"#ffffff"
        })).unwrap();
        let geometry = analyze(&piece);
        assert!(geometry.issues.iter().all(|i| i.severity != "error"), "{:?}", geometry.issues);
        assert!(geometry.cut.len() >= 3);
        assert!((geometry.area_mm2 - area(&p).abs()).abs() < 1e-8);
    }
}

#[test]
fn outer_hole_and_hole_hole_real_contacts_are_rejected() {
    let outer = points(&[(0.,0.),(100.,0.),(100.,100.),(0.,100.)]);
    let contours = |holes: Vec<Vec<Point>>| {
        let piece: Piece = serde_json::from_value(serde_json::json!({
            "id":"hole-contact", "name":"Hole contact", "nodes":outer,
            "holes":holes, "closed":true, "allowanceMm":0., "join":"round",
            "cutQty":1, "mirror":false, "material":"Fabric", "furRad":0., "color":"#ffffff"
        })).unwrap();
        advanced::contours(&piece)
    };
    for ring in [
        vec![(0.,20.),(20.,20.),(20.,40.),(0.,40.)], // shared outer segment
        vec![(0.,30.),(20.,20.),(20.,40.)], // one outer contact point
        vec![(-1.,20.),(20.,20.),(20.,40.),(-1.,40.)], // true crossing
    ] {
        assert!(matches!(contours(vec![points(&ring)]), Err("holeOutside")));
    }
    let first = points(&[(20.,20.),(40.,20.),(40.,40.),(20.,40.)]);
    for second in [
        vec![(40.,20.),(60.,20.),(60.,40.),(40.,40.)], // shared segment
        vec![(40.,40.),(60.,40.),(60.,60.),(40.,60.)], // one endpoint
        vec![(30.,30.),(50.,30.),(50.,50.),(30.,50.)], // overlap
    ] {
        assert!(matches!(contours(vec![first.clone(),points(&second)]), Err("holeOverlap")));
    }
    assert!(contours(vec![first,points(&[(50.,50.),(70.,50.),(70.,70.),(50.,70.)])]).is_ok());
}
