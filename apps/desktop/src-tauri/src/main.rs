#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

mod backend_wire;
#[cfg(test)]
mod json_precision;

type Reply = Result<Value, String>;
// Compiled out of release builds; automation never adds general execution APIs.
#[cfg(debug_assertions)]
#[tauri::command]
fn test_control(window: tauri::WebviewWindow, action: String, payload: Value) -> Reply {
    if window.label() != "main" || std::env::var_os("FPCAD_TEST_NATIVE_DIR").is_none() {
        return Err("FORBIDDEN".into());
    }
    match action.as_str() {
        "state" => {
            let backend = window.state::<Arc<Backend>>();
            Ok(
                json!({"visible":window.is_visible().map_err(|e|e.to_string())?,"id":"main","applicationDirectory":backend.root}),
            )
        }
        "close" => {
            window.close().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "emit" => {
            let event = payload["event"].as_str().ok_or("INVALID_EVENT")?;
            if !matches!(
                event,
                "fpcad:changed"
                    | "fpcad:storage-error"
                    | "fpcad:surface-progress"
                    | "fpcad:dialog-state"
            ) {
                return Err("FORBIDDEN".into());
            }
            window
                .emit(event, &payload["value"])
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("FORBIDDEN".into()),
    }
}
struct Backend {
    #[cfg(debug_assertions)]
    root: std::path::PathBuf,
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    closing: AtomicBool,
}
impl Backend {
    fn write(&self, value: Value) -> Result<(), String> {
        let mut input = self.input.lock().map_err(|_| "BACKEND_LOCK")?;
        serde_json::to_writer(&mut *input, &value).map_err(|e| e.to_string())?;
        input
            .write_all(b"\n")
            .and_then(|_| input.flush())
            .map_err(|e| e.to_string())
    }
    async fn call(&self, channel: &str, payload: Value) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(error) = self.write(json!({"id":id,"channel":channel,"payload":payload})) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        rx.await.map_err(|_| "BACKEND_EXITED".to_string())?
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

#[tauri::command]
async fn desktop_request(
    window: tauri::WebviewWindow,
    backend: tauri::State<'_, Arc<Backend>>,
    channel: String,
    payload: Value,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main"
        || !matches!(
            channel.as_str(),
            "fpcad:request" | "fpcad:request-text" | "fpcad:assistant" | "fpcad:assistant-settings"
        )
    {
        return Err("FORBIDDEN".into());
    }
    if backend.closing.load(Ordering::SeqCst) {
        return Err("BACKEND_CLOSING".into());
    }
    if serde_json::to_vec(&payload)
        .map_err(|e| e.to_string())?
        .len()
        > 64 * 1024 * 1024
    {
        return Err("RESOURCE_LIMIT".into());
    }
    let value = backend.call(&channel, payload).await?;
    match (channel.as_str(), value) {
        ("fpcad:request-text", Value::String(text)) => {
            Ok(tauri::ipc::Response::new(text.into_bytes()))
        }
        (_, value) => Ok(tauri::ipc::Response::new(
            serde_json::to_string(&value).map_err(|e| e.to_string())?,
        )),
    }
}

fn native(app: tauri::AppHandle, backend: Arc<Backend>, message: Value) {
    let id = message["native"].clone();
    #[cfg(debug_assertions)]
    if let Some(directory) = std::env::var_os("FPCAD_TEST_NATIVE_DIR") {
        let directory = std::path::PathBuf::from(directory);
        let request = directory.join(format!("{}.request.json", id.as_str().unwrap()));
        let response = directory.join(format!("{}.response.json", id.as_str().unwrap()));
        if std::fs::write(&request, serde_json::to_vec(&message).unwrap()).is_ok() {
            let started = std::time::Instant::now();
            while started.elapsed().as_secs() < 120 {
                if let Ok(bytes) = std::fs::read(&response) {
                    if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                        let _ = backend.write(value);
                        return;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
        let _ = backend.write(json!({"native":id,"error":"TEST_NATIVE_TIMEOUT"}));
        return;
    }
    let options = &message["payload"];
    if message["method"] == "print" {
        let html = options["html"].as_str().unwrap_or("").to_string();
        let result = (|| -> Result<(), String> {
            let label = format!("print-{}", id.as_str().ok_or("INVALID_PRINT_ID")?);
            let backend_reply = backend.clone();
            let print_id = id.clone();
            let printed = AtomicBool::new(false);
            tauri::WebviewWindowBuilder::new(&app,&label,tauri::WebviewUrl::App("print.html".into()))
                .title("FurryPattern CAD · 1:1 print").inner_size(900.,700.)
                .initialization_script(format!("document.addEventListener('DOMContentLoaded',()=>{{document.open();document.write({});document.close();}},{{once:true}});",serde_json::to_string(&html).unwrap()))
                .on_navigation(|url|url.scheme()=="tauri" || (matches!(url.scheme(),"http"|"https")&&url.host_str()==Some("tauri.localhost")))
                .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
                .on_page_load(move|window,event|{if event.event()==tauri::webview::PageLoadEvent::Finished && !printed.swap(true,Ordering::SeqCst){
                    let result=match window.print(){Ok(())=>json!({"native":print_id,"value":null}),Err(error)=>json!({"native":print_id,"error":error.to_string()})};let _=backend_reply.write(result);
                }})
                .build().map_err(|e|e.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = backend.write(json!({"native":id,"error":error}));
        }
        return;
    }
    let mut dialog = rfd::FileDialog::new();
    if let Some(title) = options["title"].as_str() {
        dialog = dialog.set_title(title);
    }
    if let Some(path) = options["defaultPath"].as_str() {
        dialog = dialog.set_file_name(path);
    }
    if let Some(filters) = options["filters"].as_array() {
        for filter in filters {
            let extensions: Vec<&str> = filter["extensions"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            dialog = dialog.add_filter(filter["name"].as_str().unwrap_or("File"), &extensions);
        }
    }
    let value = match message["method"].as_str() {
        Some("open") => match dialog.pick_file() {
            Some(path) => json!({"canceled":false,"filePaths":[path]}),
            None => json!({"canceled":true,"filePaths":[]}),
        },
        Some("save") => match dialog.save_file() {
            Some(path) => json!({"canceled":false,"filePath":path}),
            None => json!({"canceled":true}),
        },
        _ => {
            let _ = backend.write(json!({"native":id,"error":"FORBIDDEN"}));
            return;
        }
    };
    let _ = backend.write(json!({"native":id,"value":value}));
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![desktop_request, test_control]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![desktop_request]);
    // Isolated background tests must neither activate an existing window nor
    // reuse its project/backend when another test or the user's app is open.
    let background_test =
        cfg!(debug_assertions) && std::env::args().any(|a| a == "--fpcad-background-test");
    let builder = if background_test {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--fpcad-background-test") {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
    };
    builder
        .setup(|app| {
            let root = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
            } else {
                app.path().resource_dir()?
            };
            #[cfg(debug_assertions)]
            let root = std::env::var_os("FPCAD_TEST_APP_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(root);
            // Tauri returns a verbatim Windows path in packaged builds. Node's
            // module loader cannot resolve that prefix even for ordinary paths.
            let root = dunce::canonicalize(root)?;
            let data = std::env::var_os("FPCAD_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    std::env::var_os("APPDATA")
                        .map(std::path::PathBuf::from)
                        .unwrap_or(root.clone())
                        .join("FurryPatternCAD")
                });
            std::fs::create_dir_all(&data)?;
            let mut command = Command::new(root.join("dist/bin/node.exe"));
            #[cfg(debug_assertions)]
            if std::env::var_os("FPCAD_TEST_NATIVE_DIR").is_some() {
                if let Ok(port) = std::env::var("FPCAD_TEST_INSPECTOR_PORT") {
                    if let Ok(port) = port.parse::<u16>() {
                        command.arg(format!("--inspect=127.0.0.1:{port}"));
                    }
                }
            }
            command
                .current_dir(&root)
                .arg("dist/main/main.cjs")
                .env("FPCAD_DATA_DIR", data)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn()?;
            let output = child.stdout.take().unwrap();
            let backend = Arc::new(Backend {
                #[cfg(debug_assertions)]
                root,
                input: Mutex::new(child.stdin.take().unwrap()),
                child: Mutex::new(child),
                pending: Mutex::new(HashMap::new()),
                next: AtomicU64::new(1),
                closing: AtomicBool::new(false),
            });
            app.manage(backend.clone());
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(|url| {
                    url.scheme() == "tauri"
                        || (matches!(url.scheme(), "http" | "https")
                            && url.host_str() == Some("tauri.localhost"))
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .initialization_script(
                    if std::env::args().any(|a| a == "--fpcad-background-test") {
                        "window.__fpcadTestLocale='zh-CN';"
                    } else {
                        ""
                    },
                )
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(output).lines() {
                    let Ok(line) = line else { break };
                    if line.starts_with(backend_wire::TEXT_RESPONSE_PREFIX) {
                        let Ok((id, text)) = backend_wire::text_response(line) else {
                            break;
                        };
                        if let Some(tx) = backend.pending.lock().unwrap().remove(&id) {
                            let _ = tx.send(Ok(Value::String(text)));
                        }
                        continue;
                    }
                    let Ok(message) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if let Some(id) = message["id"].as_u64() {
                        if let Some(tx) = backend.pending.lock().unwrap().remove(&id) {
                            let _ = tx.send(if let Some(error) = message["error"].as_str() {
                                Err(error.into())
                            } else {
                                Ok(message["value"].clone())
                            });
                        }
                    } else if message["native"].is_string() {
                        let h = handle.clone();
                        let b = backend.clone();
                        std::thread::spawn(move || native(h, b, message));
                    } else if let Some(event) = message["event"].as_str() {
                        if event == "fpcad:ready"
                            && !std::env::args().any(|a| a == "--fpcad-background-test")
                        {
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        if matches!(
                            event,
                            "fpcad:changed"
                                | "fpcad:storage-error"
                                | "fpcad:surface-progress"
                                | "fpcad:dialog-state"
                        ) {
                            let _ = handle.emit_to("main", event, &message["payload"]);
                        }
                    }
                }
                for (_, tx) in backend.pending.lock().unwrap().drain() {
                    let _ = tx.send(Err("BACKEND_EXITED".into()));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let backend = window.state::<Arc<Backend>>().inner().clone();
                if backend.closing.swap(true, Ordering::SeqCst) {
                    return;
                }
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    match backend.call("shutdown", Value::Null).await {
                        Ok(_) => {
                            let _ = backend.child.lock().unwrap().kill();
                            app.exit(0);
                        }
                        Err(_) => {
                            backend.closing.store(false, Ordering::SeqCst);
                            rfd::MessageDialog::new()
                                .set_title("FurryPattern CAD")
                                .set_description("无法保存恢复点。请释放磁盘空间后再关闭。")
                                .set_level(rfd::MessageLevel::Error)
                                .show();
                        }
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to start FurryPattern CAD");
}
