use geometry_core::{analyze, boolean, Piece};
use serde_json::json;
use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    if io::stdin()
        .take(64 * 1024 * 1024 + 1)
        .read_to_string(&mut input)
        .is_err()
        || input.len() > 64 * 1024 * 1024
    {
        println!("{}", json!({"ok":false,"code":"RESOURCE_LIMIT"}));
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(_) => {
            println!("{}", json!({"ok":false,"code":"VALIDATION_ERROR"}));
            return;
        }
    };
    if value.get("protocolVersion") != Some(&json!(1)) {
        println!("{}", json!({"ok":false,"code":"PROTOCOL_UNSUPPORTED"}));
        return;
    }
    if value.get("operation") == Some(&json!("geometry.clip")) {
        let jobs = match serde_json::from_value(value["jobs"].clone()) {
            Ok(v) => v,
            Err(_) => {
                println!("{}", json!({"ok":false,"code":"VALIDATION_ERROR"}));
                return;
            }
        };
        match geometry_core::clipping::batch(jobs) {
            Ok(results) => println!(
                "{}",
                json!({"ok":true,"protocolVersion":1,"results":results})
            ),
            Err(code) => println!("{}", json!({"ok":false,"code":code})),
        };
        return;
    }
    if value.get("operation") == Some(&json!("surface.unwrap")) {
        let mesh: geometry_core::surface::Mesh = match serde_json::from_value(value["mesh"].clone())
        {
            Ok(m) => m,
            Err(_) => {
                println!("{}", json!({"ok":false,"code":"INVALID_MESH"}));
                return;
            }
        };
        match geometry_core::surface::unwrap_mesh(&mesh) {
            Ok(patches) => println!(
                "{}",
                json!({"ok":true,"protocolVersion":1,"patches":patches})
            ),
            Err(code) => println!("{}", json!({"ok":false,"code":code})),
        };
        return;
    }
    let pieces: Vec<Piece> = match serde_json::from_value(value["pieces"].clone()) {
        Ok(p) => p,
        Err(_) => {
            println!("{}", json!({"ok":false,"code":"VALIDATION_ERROR"}));
            return;
        }
    };
    if pieces.len() > 500 {
        println!("{}", json!({"ok":false,"code":"RESOURCE_LIMIT"}));
        return;
    }
    if let Some(operation) = value.get("operation").and_then(|v| v.as_str()) {
        if pieces.len() != 2 {
            println!("{}", json!({"ok":false,"code":"VALIDATION_ERROR"}));
            return;
        }
        match boolean(&pieces[0], &pieces[1], operation) {
            Ok(polygons) => println!(
                "{}",
                json!({"ok":true,"protocolVersion":1,"polygons":polygons})
            ),
            Err(code) => println!("{}", json!({"ok":false,"code":code})),
        }
        return;
    }
    let result: Vec<_> = pieces.iter().map(analyze).collect();
    println!(
        "{}",
        json!({"ok":true,"protocolVersion":1,"geometry":result})
    );
}
