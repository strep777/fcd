use serde_json::Value;

#[test]
fn ipc_preserves_contour_coordinates_across_repeated_reads_and_edits() {
    // The first coordinate previously changed one ULP on every IPC parse.
    // Even an unchanged edit must retain the exact geometry and fingerprint.
    let coordinates: [f64; 7] = [
        -5.5108101000737325e-15,
        421.31319111392395,
        1.177772994699332,
        -59.95374217444337,
        0.1,
        1800.0000000000002,
        f64::MIN_POSITIVE,
    ];
    let mut wire = serde_json::to_string(&coordinates).unwrap();
    for _ in 0..8 {
        let message: Value = serde_json::from_str(&wire).unwrap();
        for (index, expected) in coordinates.iter().enumerate() {
            assert_eq!(
                message[index].as_f64().unwrap().to_bits(),
                expected.to_bits()
            );
        }
        wire = serde_json::to_string(&message).unwrap();
    }
}
