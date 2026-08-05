//// Pocket ID OIDC authentication helpers.

import gleam/bit_array
import gleam/dynamic/decode
import gleam/http
import gleam/http/request
import gleam/httpc
import gleam/int
import gleam/json
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import gleam/uri
import friends/config.{type Config, authorize_url, token_url}
import friends/session.{type UserSession, UserSession, clear, write}
import wisp

pub const state_cookie = "friends_oauth_state"

pub const state_cookie_max_age = 600

/// Begin login by setting the OAuth state cookie on a same-origin 200 response,
/// then bounce to the identity provider via meta-refresh.
///
/// Setting the cookie on a cross-site 303 (directly to Pocket ID) is unreliable:
/// browsers' redirect-tracking mitigations often drop that cookie before the
/// callback, which surfaces as "missing oauth state cookie".
pub fn login_redirect(config: Config, request: wisp.Request) -> wisp.Response {
  let state = random_token()
  let location = idp_authorize_location(config, state)
  let body =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    <> "<meta http-equiv=\"refresh\" content=\"0;url="
    <> html_attr(location)
    <> "\">"
    <> "<title>Redirecting…</title></head><body>"
    <> "<p>Redirecting to sign in… "
    <> "<a href=\""
    <> html_attr(location)
    <> "\">Continue</a></p>"
    <> "</body></html>"

  wisp.html_response(body, 200)
  |> wisp.set_cookie(
    request,
    state_cookie,
    state,
    wisp.Signed,
    state_cookie_max_age,
  )
}

pub fn callback(
  config: Config,
  request: wisp.Request,
) -> Result(#(UserSession, wisp.Response), String) {
  use _ <- result.try(reject_oauth_error(request))
  use code <- result.try(query_param(request, "code"))
  use state <- result.try(query_param(request, "state"))
  use expected_state <- result.try(read_state_cookie(request))
  use _ <- result.try(case state == expected_state {
    True -> Ok(Nil)
    False -> Error("invalid oauth state")
  })

  use token_body <- result.try(exchange_code(config, code))
  use sub <- result.try(token_subject(token_body))
  let name = token_name(token_body)
  let user = UserSession(sub: sub, name: name)
  // Set the session cookie on a same-origin 200 bounce, not a 303.
  // The callback arrives via a cross-site redirect from Pocket ID; browsers'
  // bounce-tracking mitigations often drop cookies set on the subsequent 303
  // to "/", which shows up as: sign-in works once, then refresh returns to
  // the guest page.
  let response =
    post_login_bounce("/")
    |> write(request, user)
    |> clear_state_cookie(request)

  Ok(#(user, response))
}

fn post_login_bounce(location: String) -> wisp.Response {
  let body =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    <> "<meta http-equiv=\"refresh\" content=\"0;url="
    <> html_attr(location)
    <> "\">"
    <> "<title>Signed in…</title></head><body>"
    <> "<p>Signed in. "
    <> "<a href=\""
    <> html_attr(location)
    <> "\">Continue</a></p>"
    <> "</body></html>"

  wisp.html_response(body, 200)
}

pub fn logout(request: wisp.Request) -> wisp.Response {
  wisp.redirect("/")
  |> clear(request)
}

fn idp_authorize_location(config: Config, state: String) -> String {
  authorize_url(config)
  <> "?"
  <> uri.query_to_string([
    #("response_type", "code"),
    #("client_id", config.oidc_client_id),
    #("redirect_uri", config.oidc_redirect_uri),
    #("scope", "openid profile email"),
    #("state", state),
  ])
}

fn reject_oauth_error(request: wisp.Request) -> Result(Nil, String) {
  case query_param(request, "error") {
    Ok(error) -> {
      let description = case query_param(request, "error_description") {
        Ok(value) -> ": " <> value
        Error(_) -> ""
      }
      Error("identity provider returned " <> error <> description)
    }
    Error(_) -> Ok(Nil)
  }
}

fn read_state_cookie(request: wisp.Request) -> Result(String, String) {
  case wisp.get_cookie(request, state_cookie, wisp.Signed) {
    Ok(value) -> Ok(value)
    Error(_) ->
      case has_cookie_named(request, state_cookie) {
        True -> Error("oauth state cookie was present but could not be verified")
        False ->
          Error(
            "missing oauth state cookie (try signing in again; if this persists, clear friends.boxd.sh cookies)",
          )
      }
  }
}

fn has_cookie_named(request: wisp.Request, name: String) -> Bool {
  request
  |> request.get_cookies
  |> list_key_exists(name)
}

fn list_key_exists(params: List(#(String, String)), key: String) -> Bool {
  case params {
    [] -> False
    [#(name, _), ..rest] ->
      case name == key {
        True -> True
        False -> list_key_exists(rest, key)
      }
  }
}

fn clear_state_cookie(
  response: wisp.Response,
  request: wisp.Request,
) -> wisp.Response {
  response
  |> wisp.set_cookie(request, state_cookie, "", wisp.Signed, 0)
}

fn query_param(request: wisp.Request, key: String) -> Result(String, String) {
  case wisp.get_query(request) {
    [] -> Error("missing query parameter: " <> key)
    params ->
      case list_find(params, key) {
        Some(value) -> Ok(value)
        None -> Error("missing query parameter: " <> key)
      }
  }
}

fn list_find(
  params: List(#(String, String)),
  key: String,
) -> Option(String) {
  case params {
    [] -> None
    [#(name, value), ..rest] ->
      case name == key {
        True -> Some(value)
        False -> list_find(rest, key)
      }
  }
}

fn exchange_code(config: Config, code: String) -> Result(String, String) {
  let form_body =
    uri.query_to_string([
      #("grant_type", "authorization_code"),
      #("code", code),
      #("redirect_uri", config.oidc_redirect_uri),
      #("client_id", config.oidc_client_id),
      #("client_secret", config.oidc_client_secret),
    ])

  use parsed_uri <- result.try(
    uri.parse(token_url(config))
    |> result.map_error(fn(_) { "invalid token endpoint" }),
  )
  use base_request <- result.try(
    request.from_uri(parsed_uri)
    |> result.map_error(fn(_) { "invalid token request" }),
  )

  let req =
    base_request
    |> request.set_method(http.Post)
    |> request.set_header("content-type", "application/x-www-form-urlencoded")
    |> request.set_header("accept", "application/json")
    |> request.set_body(form_body)

  use resp <- result.try(
    httpc.send(req)
    |> result.map_error(fn(_) { "failed to contact identity provider" }),
  )

  case resp.status >= 200 && resp.status < 300 {
    True -> Ok(resp.body)
    False ->
      Error(
        "token exchange failed with status "
        <> int.to_string(resp.status)
        <> ": "
        <> string.slice(resp.body, at_index: 0, length: 200),
      )
  }
}

fn token_subject(body: String) -> Result(String, String) {
  let decoder = {
    use sub <- decode.field("sub", decode.string)
    decode.success(sub)
  }

  case json.parse(body, decoder) {
    Ok(sub) -> Ok(sub)
    Error(_) -> decode_id_token_subject(body)
  }
}

fn token_name(body: String) -> Option(String) {
  case preferred_username(body) {
    Some(value) -> Some(value)
    None ->
      case name_claim(body) {
        Some(value) -> Some(value)
        None -> id_token_name(body)
      }
  }
}

fn preferred_username(body: String) -> Option(String) {
  let decoder = {
    use name <- decode.field(
      "preferred_username",
      decode.optional(decode.string),
    )
    decode.success(name)
  }

  case json.parse(body, decoder) {
    Ok(name) -> name
    Error(_) -> None
  }
}

fn name_claim(body: String) -> Option(String) {
  let decoder = {
    use name <- decode.field("name", decode.optional(decode.string))
    decode.success(name)
  }

  case json.parse(body, decoder) {
    Ok(name) -> name
    Error(_) -> None
  }
}

fn id_token_name(body: String) -> Option(String) {
  let decoder = {
    use token <- decode.field("id_token", decode.string)
    decode.success(token)
  }

  case json.parse(body, decoder) {
    Ok(id_token) ->
      case decode_jwt_claim(id_token, "preferred_username") {
        Ok(value) -> Some(value)
        Error(_) ->
          case decode_jwt_claim(id_token, "name") {
            Ok(value) -> Some(value)
            Error(_) -> None
          }
      }
    Error(_) -> None
  }
}

fn decode_id_token_subject(body: String) -> Result(String, String) {
  let decoder = {
    use token <- decode.field("id_token", decode.string)
    decode.success(token)
  }

  use id_token <- result.try(
    json.parse(body, decoder)
    |> result.map_error(fn(_) { "token response did not include a subject" }),
  )

  decode_jwt_claim(id_token, "sub")
  |> result.map_error(fn(_) { "id token payload did not include sub" })
}

fn decode_jwt_claim(token: String, claim: String) -> Result(String, Nil) {
  case string.split(token, ".") {
    [_, payload, ..] -> {
      let padded = base64url_to_base64(payload)
      case bit_array.base64_decode(padded) {
        Ok(bits) ->
          case bit_array.to_string(bits) {
            Ok(json_string) -> {
              let decoder = {
                use value <- decode.field(claim, decode.string)
                decode.success(value)
              }

              json.parse(json_string, decoder)
              |> result.map_error(fn(_) { Nil })
            }
            Error(_) -> Error(Nil)
          }
        Error(_) -> Error(Nil)
      }
    }
    _ -> Error(Nil)
  }
}

fn base64url_to_base64(value: String) -> String {
  let replaced =
    value
    |> string.replace(each: "-", with: "+")
    |> string.replace(each: "_", with: "/")

  let remainder = string.length(replaced) % 4
  let padding = case remainder {
    0 -> ""
    2 -> "=="
    3 -> "="
    _ -> ""
  }

  replaced <> padding
}

fn html_attr(value: String) -> String {
  value
  |> string.replace(each: "&", with: "&amp;")
  |> string.replace(each: "\"", with: "&quot;")
  |> string.replace(each: "<", with: "&lt;")
}

@external(erlang, "crypto", "strong_rand_bytes")
fn strong_rand_bytes(count: Int) -> BitArray

fn random_token() -> String {
  strong_rand_bytes(24)
  |> bit_array.base64_encode(False)
  |> string.replace(each: "+", with: "-")
  |> string.replace(each: "/", with: "_")
  |> string.replace(each: "=", with: "")
}
