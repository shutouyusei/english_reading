mod platform;

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

fn main() -> wry::Result<()> {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("TOEFL Reading")
        .build(&event_loop)
        .expect("ウィンドウを作成できません");

    let _webview = WebViewBuilder::new()
        .with_html("<html><body>app-shell scaffold</body></html>")
        .build(&window)
        .expect("WebViewを作成できません");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *control_flow = ControlFlow::Exit;
        }
    });
}
