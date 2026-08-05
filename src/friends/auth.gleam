//// Pocket ID OIDC authentication helpers.

import gleam/bit_array
import gleam/crypto
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
import friends/browser
import friends/config.{type Config, authorize_url, token_url}
import friends/html
import friends/session.{type UserSession, UserSession, clear, write}
import wisp

pub const state_max_age_seconds = 600

/// Begin login with a signed OAuth state bound to the long-lived browser cookie.
///
/// Short-lived oauth-state cookies are dropped by bounce-tracking when the
/// browser leaves for Pocket ID. Instead we:
/// 1. ensure `friends_browser` (ideally already set on `/`)
/// 2. put a signed `browser_id:nonce:expiry` value in the OAuth `state` param
/// 3. verify that signature + browser cookie on callback
pub fn login_redirect(config: Config, request: wisp.Request) -> wisp.Response {
  let #(browser_id, with_browser) = browser_binder(request)
  let state = mint_state(config, browser_id)
  let location = idp_authorize_location(config, state)
  let body =
    html.page(
      "Continue to sign in",
      "<header><h1>Friends</h1></header>"
        <> "<p>Continue to Pocket ID to finish signing in.</p>"
        <> "<p><a class=\"btn\" href=\""
        <> html.escape_attr(location)
        <> "\">Continue to Pocket ID</a></p>"
        <> "<p class=\"meta\">Identity provider: "
        <> html.escape_text(config.oidc_issuer)
        <> "</p>",
    )

  wisp.html_response(body, 200)
  |> with_browser
}

pub fn callback(
  config: Config,
  request: wisp.Request,
) -> Result(#(UserSession, wisp.Response), String) {
  use _ <- result.try(reject_oauth_error(request))
  use code <- result.try(query_param(request, "code"))
  use state <- result.try(query_param(request, "state"))
  use browser_id <- result.try(require_browser_id(request))
  use _ <- result.try(verify_state(config, state, browser_id))

  use token_body <- result.try(exchange_code(config, code))
  use sub <- result.try(token_subject(token_body))
  let name = token_name(token_body)
  let user = UserSession(sub: sub, name: name)
  // Keep a click-through continue page so bounce-tracking does not drop the
  // newly set friends_session cookie.
  let response =
    post_login_continue("/")
    |> write(request, user)
    |> browser.write(request, browser_id)

  Ok(#(user, response))
}

/// Create a signed OAuth state for tests and login.
pub fn mint_state(config: Config, browser_id: String) -> String {
  let expiry = unix_seconds() + state_max_age_seconds
  let nonce = random_token()
  let payload = browser_id <> ":" <> nonce <> ":" <> int.to_string(expiry)
  crypto.sign_message(
    <<payload:utf8>>,
    <<config.secret_key_base:utf8>>,
    crypto.Sha512,
  )
}

/// Verify signed OAuth state for tests and callback.
pub fn verify_state(
  config: Config,
  state: String,
  browser_id: String,
) -> Result(Nil, String) {
  use payload_bits <- result.try(
    crypto.verify_signed_message(state, <<config.secret_key_base:utf8>>)
    |> result.map_error(fn(_) { "invalid oauth state signature" }),
  )
  use payload <- result.try(
    bit_array.to_string(payload_bits)
    |> result.map_error(fn(_) { "invalid oauth state payload" }),
  )

  case string.split(payload, ":") {
    [state_browser_id, _nonce, expiry_raw] -> {
      use expiry <- result.try(
        int.parse(expiry_raw)
        |> result.map_error(fn(_) { "invalid oauth state expiry" }),
      )
      case state_browser_id == browser_id {
        False -> Error("oauth state was not issued for this browser")
        True ->
          case unix_seconds() <= expiry {
            True -> Ok(Nil)
            False -> Error("oauth state expired; try signing in again")
          }
      }
    }
    _ -> Error("invalid oauth state format")
  }
}

fn browser_binder(request: wisp.Request) -> #(String, fn(wisp.Response) -> wisp.Response) {
  case browser.read(request) {
    Some(id) -> #(id, fn(response) { response })
    None -> {
      let id = browser.new_id()
      #(id, fn(response) { browser.write(response, request, id) })
    }
  }
}

fn require_browser_id(request: wisp.Request) -> Result(String, String) {
  case browser.read(request) {
    Some(id) -> Ok(id)
    None ->
      Error(
        "missing browser cookie (open https://friends.boxd.sh/ once, then sign in again)",
      )
  }
}

fn post_login_continue(location: String) -> wisp.Response {
  let body =
    html.page(
      "Signed in",
      "<header><h1>Friends</h1></header>"
        <> "<p>You are signed in.</p>"
        <> "<p><a class=\"btn\" href=\""
        <> html.escape_attr(location)
        <> "\">Continue to Friends</a></p>",
    )

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
    use name <- decode.optional_field(
      "preferred_username",
      None,
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
    use name <- decode.optional_field(
      "name",
      None,
      decode.optional(decode.string),
    )
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

@external(erlang, "crypto", "strong_rand_bytes")
fn strong_rand_bytes(count: Int) -> BitArray

@external(erlang, "friends_ffi", "unix_seconds")
fn unix_seconds() -> Int

fn random_token() -> String {
  strong_rand_bytes(24)
  |> bit_array.base64_encode(False)
  |> string.replace(each: "+", with: "-")
  |> string.replace(each: "/", with: "_")
  |> string.replace(each: "=", with: "")
}
