use geometry_core::{analyze, boolean, Piece};
use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};
const MAX_INPUT: usize = 64 * 1024 * 1024;
fn execute(input: &str) -> Value {
    let value: Value = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(_) => return json!({"ok":false,"code":"VALIDATION_ERROR"}),
    };
    if value.get("protocolVersion") != Some(&json!(1)) {
        return json!({"ok":false,"code":"PROTOCOL_UNSUPPORTED"});
    }
    if value.get("operation") == Some(&json!("geometry.clip")) {
        let jobs = match serde_json::from_value(value["jobs"].clone()) {
            Ok(v) => v,
            Err(_) => return json!({"ok":false,"code":"VALIDATION_ERROR"}),
        };
        return match geometry_core::clipping::batch(jobs) {
            Ok(results) => json!({"ok":true,"protocolVersion":1,"results":results}),
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    if value.get("operation") == Some(&json!("surface.unwrap")) {
        let mesh: geometry_core::surface::Mesh = match serde_json::from_value(value["mesh"].clone()) {
            Ok(m) => m,
            Err(_) => return json!({"ok":false,"code":"INVALID_MESH"}),
        };
        return match geometry_core::surface::unwrap_mesh(&mesh) {
            Ok(patches) => json!({"ok":true,"protocolVersion":1,"patches":patches}),
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    let pieces: Vec<Piece> = match serde_json::from_value(value["pieces"].clone()) {
        Ok(p) => p,
        Err(_) => return json!({"ok":false,"code":"VALIDATION_ERROR"}),
    };
    if pieces.len() > 500 { return json!({"ok":false,"code":"RESOURCE_LIMIT"}); }
    if let Some(operation) = value.get("operation").and_then(|v| v.as_str()) {
        if pieces.len() != 2 { return json!({"ok":false,"code":"VALIDATION_ERROR"}); }
        return match boolean(&pieces[0], &pieces[1], operation) {
            Ok(polygons) => json!({"ok":true,"protocolVersion":1,"polygons":polygons}),
            Err(code) => json!({"ok":false,"code":code}),
        };
    }
    let result: Vec<_> = pieces.iter().map(analyze).collect();
    json!({"ok":true,"protocolVersion":1,"geometry":result})
}
fn main() {
    // One stream belongs to one cancellable calculation. Bounded independent
    // requests retain no geometry between calls; EOF mode stays compatible.
    if std::env::args().nth(1).as_deref() == Some("--stream") {
        let mut input = io::stdin().lock();
        let mut output = io::BufWriter::new(io::stdout().lock());
        loop {
            let mut line = Vec::new();
            let read = Read::by_ref(&mut input).take((MAX_INPUT + 2) as u64).read_until(b'\n', &mut line);
            match read {
                Ok(0) => break,
                Ok(_) if line.last() == Some(&b'\n') && line.len() <= MAX_INPUT + 1 => {}
                _ => {
                    let _ = writeln!(output, "{}", json!({"ok":false,"code":"RESOURCE_LIMIT"}));
                    let _ = output.flush();
                    break;
                }
            }
            let response = match std::str::from_utf8(&line) {
                Ok(text) => execute(text),
                Err(_) => json!({"ok":false,"code":"VALIDATION_ERROR"}),
            };
            if writeln!(output, "{response}").and_then(|_| output.flush()).is_err() { break; }
        }
    } else {
        let mut input = String::new();
        if io::stdin().take((MAX_INPUT + 1) as u64).read_to_string(&mut input).is_err() || input.len() > MAX_INPUT {
            println!("{}", json!({"ok":false,"code":"RESOURCE_LIMIT"}));
            return;
        }
        println!("{}", execute(&input));
    }
}
