//// Small HTML helpers.

import gleam/string

pub fn escape_text(value: String) -> String {
  value
  |> string.replace(each: "&", with: "&amp;")
  |> string.replace(each: "<", with: "&lt;")
  |> string.replace(each: ">", with: "&gt;")
  |> string.replace(each: "\"", with: "&quot;")
}

pub fn escape_attr(value: String) -> String {
  escape_text(value)
}

pub fn page(title: String, body: String) -> String {
  "<!doctype html>"
  <> "<html lang=\"en\">"
  <> "<head>"
  <> "<meta charset=\"utf-8\">"
  <> "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
  <> "<title>"
  <> escape_text(title)
  <> "</title>"
  <> "<style>"
  <> "body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}"
  <> "header{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem}"
  <> "h1{font-size:1.5rem;margin:0}"
  <> "form{display:flex;gap:.5rem;margin:1rem 0}"
  <> "input[type=text]{flex:1;padding:.5rem .75rem;border:1px solid #ccc;border-radius:.375rem}"
  <> "button,.btn{padding:.5rem .9rem;border:0;border-radius:.375rem;background:#2563eb;color:#fff;cursor:pointer;text-decoration:none;display:inline-block}"
  <> "button.secondary,.btn.secondary{background:#e5e7eb;color:#111}"
  <> "ul.handles{list-style:none;padding:0;margin:0}"
  <> "li.handle{display:flex;justify-content:space-between;align-items:center;padding:.75rem 0;border-bottom:1px solid #eee}"
  <> ".meta{color:#666;font-size:.9rem}"
  <> ".flash{padding:.75rem 1rem;background:#ecfdf5;border-radius:.375rem;margin-bottom:1rem}"
  <> "</style>"
  <> "</head>"
  <> "<body>"
  <> body
  <> "</body></html>"
}
