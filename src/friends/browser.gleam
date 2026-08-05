//// Long-lived first-party browser id used to bind OAuth state.

import gleam/bit_array
import gleam/option.{type Option, None, Some}
import gleam/string
import wisp

pub const cookie_name = "friends_browser"

pub const cookie_max_age = 31_536_000

pub fn read(request: wisp.Request) -> Option(String) {
  case wisp.get_cookie(request, cookie_name, wisp.Signed) {
    Ok(value) ->
      case string.trim(value) {
        "" -> None
        id -> Some(id)
      }
    Error(_) -> None
  }
}

/// Ensure a durable browser id cookie is present. Prefer setting this on
/// normal page views (home) so bounce-tracking does not drop it.
pub fn ensure(
  response: wisp.Response,
  request: wisp.Request,
) -> #(String, wisp.Response) {
  case read(request) {
    Some(id) -> #(id, response)
    None -> {
      let id = new_id()
      #(id, write(response, request, id))
    }
  }
}

pub fn write(
  response: wisp.Response,
  request: wisp.Request,
  browser_id: String,
) -> wisp.Response {
  wisp.set_cookie(
    response,
    request,
    cookie_name,
    browser_id,
    wisp.Signed,
    cookie_max_age,
  )
}

pub fn new_id() -> String {
  strong_rand_bytes(18)
  |> bit_array.base64_encode(False)
  |> string.replace(each: "+", with: "-")
  |> string.replace(each: "/", with: "_")
  |> string.replace(each: "=", with: "")
}

@external(erlang, "crypto", "strong_rand_bytes")
fn strong_rand_bytes(count: Int) -> BitArray
