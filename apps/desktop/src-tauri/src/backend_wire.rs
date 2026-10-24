pub const TEXT_RESPONSE_PREFIX: &str = "fpcad:text\t";

/// Text replies already contain JSON produced by the backend. Moving those
/// bytes through IPC avoids parsing coordinates or escaping the whole project.
pub fn text_response(mut line: String) -> Result<(u64, String), &'static str> {
    let body = line
        .strip_prefix(TEXT_RESPONSE_PREFIX)
        .ok_or("BACKEND_PROTOCOL")?;
    let separator = body.find('\t').ok_or("BACKEND_PROTOCOL")?;
    let id = body[..separator]
        .parse::<u64>()
        .map_err(|_| "BACKEND_PROTOCOL")?;
    let start = TEXT_RESPONSE_PREFIX.len() + separator + 1;
    if start == line.len() {
        return Err("BACKEND_PROTOCOL");
    }
    // Preserve the existing allocation; only the short ASCII header is removed.
    line.replace_range(..start, "");
    Ok((id, line))
}

#[cfg(test)]
mod tests {
    use super::{text_response, TEXT_RESPONSE_PREFIX};

    #[test]
    fn text_reply_keeps_coordinates_unicode_and_escaped_controls_exactly() {
        let json = r#"{"ok":true,"data":{"name":"兽装 🐾","escaped":"a\nb\tc","coordinates":[-5.5108101000737325e-15,421.31319111392395,1.177772994699332,-59.95374217444337,0.1,1800.0000000000002,2.2250738585072014e-308]}}"#;
        let frame = format!("{TEXT_RESPONSE_PREFIX}42\t{json}");
        let (id, received) = text_response(frame).unwrap();
        assert_eq!(id, 42);
        assert_eq!(received.as_bytes(), json.as_bytes());
        let response = tauri::ipc::Response::new(received.into_bytes());
        match tauri::ipc::IpcResponse::body(response).unwrap() {
            tauri::ipc::InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, json.as_bytes()),
            _ => panic!("text replies must use raw IPC"),
        }
    }

    #[test]
    fn text_reply_supports_full_request_ids_without_parsing_the_payload() {
        let json = r#"{"ok":false,"error":{"code":"CANCELLED","messageKey":"CANCELLED"}}"#;
        let (id, received) =
            text_response(format!("{TEXT_RESPONSE_PREFIX}{}\t{json}", u64::MAX)).unwrap();
        assert_eq!(id, u64::MAX);
        assert_eq!(received, json);
    }

    #[test]
    fn malformed_headers_never_become_valid_response_ids() {
        for frame in [
            "{\"id\":1,\"value\":null}",
            "fpcad:text\t1",
            "fpcad:text\t\t{}",
            "fpcad:text\t1.5\t{}",
            "fpcad:text\t18446744073709551616\t{}",
            "fpcad:text\t1\t",
        ] {
            assert_eq!(text_response(frame.into()), Err("BACKEND_PROTOCOL"));
        }
    }
}
