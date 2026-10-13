use crate::{area, offset, validate, Point};

fn points(coords: &[[f64; 2]], translation: f64) -> Vec<Point> {
    coords.iter().enumerate().map(|(i, p)| Point {
        id: format!("00000000-0000-4000-8000-{i:012x}"),
        x_mm: p[0] + translation,
        y_mm: p[1] + translation,
    }).collect()
}

#[test]
fn real_contact_sliver_has_reliable_positive_area_at_layout_offsets() {
    // Exact planar embedding of a retained base-material domain in the real
    // blue-white regression. Its shortest edge exceeds the existing 1e-6 mm
    // manufacturing threshold; its area is nevertheless below 1e-6 mm².
    let xy = [[0., 0.], [0.8556361445732252, 0.],
        [2.1599312139900788e-7, 1.8604776554196322e-6]];
    for translation in [0., 1000., 100000.] {
        let p = points(&xy, translation);
        assert!(validate(&p).is_ok(), "offset {translation}: {:?}", validate(&p));
        assert!((area(&p) / 7.959459640739437e-7 - 1.).abs() < 1e-5);
        assert_eq!(offset(&p, 0.).unwrap().len(), 3);
        let mut reverse = p.clone(); reverse.reverse();
        assert!(validate(&reverse).is_ok());
    }
}

#[test]
fn polygon_validity_keeps_zero_area_short_edge_and_crossing_guards() {
    for xy in [
        vec![[0., 0.], [1., 0.], [2., 0.]],
        vec![[0., 0.], [1., 0.], [0., 1e-7]],
        vec![[0., 0.], [2., 2.], [0., 2.], [2., 0.]],
    ] { assert!(validate(&points(&xy, 1000.)).is_err()); }
    // Opposite signed fan triangles in a valid concave outline may cancel;
    // validity must use the whole signed area, not require each fan positive.
    let concave = points(&[[0., 0.], [2., 0.], [2., 1.], [1., 0.5], [0., 1.]], 1000.);
    assert!(validate(&concave).is_ok());
}
