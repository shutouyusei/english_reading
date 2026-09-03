mod content;
mod ipc;
mod platform;

use std::cell::RefCell;
use std::rc::Rc;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

enum UserEvent {
    EvaluateScript(String),
}

fn main() -> wry::Result<()> {
    let env: std::collections::HashMap<String, String> = std::env::vars().collect();
    let current_dir = std::env::current_dir().expect("カレントディレクトリを取得できません");
    let repo_root = platform::resolve_repo_root(&env, &current_dir);

    let home = home_dir();
    let data_dir = platform::default_data_dir(&home);
    std::fs::create_dir_all(&data_dir).ok();
    std::fs::create_dir_all(data_dir.join("audio")).ok();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("TOEFL Reading")
        .with_inner_size(tao::dpi::LogicalSize::new(1100.0, 780.0))
        .build(&event_loop)
        .expect("ウィンドウを作成できません");

    let webview_holder: Rc<RefCell<Option<wry::WebView>>> = Rc::new(RefCell::new(None));

    let ipc_handler = {
        let proxy = event_loop.create_proxy();
        let root = repo_root.clone();
        let data_dir = data_dir.clone();
        move |req: wry::http::Request<String>| {
            let raw = req.body().clone();
            let proxy = proxy.clone();
            let root = root.clone();
            let data_dir = data_dir.clone();
            std::thread::spawn(move || match ipc::parse_ipc_request(&raw) {
                Ok(request) => {
                    let script = ipc::dispatch(&request, &root, &data_dir);
                    let _ = proxy.send_event(UserEvent::EvaluateScript(script));
                }
                Err(_) => {
                    eprintln!("IPCメッセージを解析できません: {raw}");
                }
            });
        }
    };

    let app_protocol = {
        let root = repo_root.clone();
        move |_id: &str, req: http::Request<Vec<u8>>| {
            let path = req.uri().path();
            let range = req.headers().get("Range").and_then(|v| v.to_str().ok());
            let (status, headers, body) = content::respond(&root, path, range);
            build_http_response(status, headers, body)
        }
    };

    let audio_protocol = {
        let audio_root = data_dir.join("audio");
        move |_id: &str, req: http::Request<Vec<u8>>| {
            let path = req.uri().path();
            let range = req.headers().get("Range").and_then(|v| v.to_str().ok());
            let (status, headers, body) = content::respond(&audio_root, path, range);
            build_http_response(status, headers, body)
        }
    };

    let webview = WebViewBuilder::new()
        .with_url("app://local/app/ui/index.html")
        .with_ipc_handler(ipc_handler)
        .with_custom_protocol("app".into(), app_protocol)
        .with_custom_protocol("audio".into(), audio_protocol)
        .build(&window)
        .expect("WebViewを作成できません");

    *webview_holder.borrow_mut() = Some(webview);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::EvaluateScript(script)) => {
                if let Some(webview) = webview_holder.borrow().as_ref() {
                    let _ = webview.evaluate_script(&script);
                }
            }
            _ => {}
        }
    });
}

fn build_http_response(
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
) -> http::Response<std::borrow::Cow<'static, [u8]>> {
    let mut builder = http::Response::builder().status(status);
    for (key, value) in headers {
        builder = builder.header(key, value);
    }
    builder.body(std::borrow::Cow::from(body)).expect("応答の組み立てに失敗しました")
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn home_dir() -> std::path::PathBuf {
    std::env::var("HOME").map(std::path::PathBuf::from).expect("HOME が設定されていません")
}

#[cfg(target_os = "windows")]
fn home_dir() -> std::path::PathBuf {
    std::env::var("USERPROFILE")
        .map(std::path::PathBuf::from)
        .expect("USERPROFILE が設定されていません")
}
