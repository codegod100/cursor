//// OpenBao OIDC authentication helpers.

import gleam/bit_array
import gleam/dynamic/decode
import gleam/http
import gleam/http/request
import gleam/http/response
import gleam/httpc
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import gleam/uri
import friends/config.{type Config, authorize_url, token_url}
import friends/session.{type UserSession, UserSession, clear, write}
import wisp

pub const state_cookie = "friends_oauth_state"

pub const state_cookie_max_age = 600

pub fn login_redirect(config: Config, request: wisp.Request) -> wisp.Response {
  let state = random_token()
  let location =
    authorize_url(config)
    <> "?"
    <> uri.query_to_string([
      #("response_type", "code"),
      #("client_id", config.oidc_client_id),
      #("redirect_uri", config.oidc_redirect_uri),
      #("scope", "openid profile email"),
      #("state", state),
    ])

  wisp.redirect(location)
  |> wisp.set_cookie(request, state_cookie, state, wisp.Signed, state_cookie_max_age)
}

pub fn callback(
  config: Config,
  request: wisp.Request,
) -> Result(#(UserSession, wisp.Response), String) {
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
  let response =
    wisp.redirect("/")
    |> write(request, user)
    |> clear_state_cookie(request)

  Ok(#(user, response))
}

pub fn logout(request: wisp.Request) -> wisp.Response {
  wisp.redirect("/")
  |> clear(request)
}

fn read_state_cookie(request: wisp.Request) -> Result(String, String) {
  case wisp.get_cookie(request, state_cookie, wisp.Signed) {
    Ok(value) -> Ok(value)
    Error(_) -> Error("missing oauth state cookie")
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
      Error("token exchange failed with status " <> int.to_string(resp.status))
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
  let decoder = {
    use name <- decode.field("name", decode.optional(decode.string))
    decode.success(name)
  }

  case json.parse(body, decoder) {
    Ok(name) -> name
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

  decode_jwt_subject(id_token)
}

fn decode_jwt_subject(token: String) -> Result(String, String) {
  case string.split(token, ".") {
    [_, payload, ..] -> {
      let padded = base64url_to_base64(payload)
      case bit_array.base64_decode(padded) {
        Ok(bits) ->
          case bit_array.to_string(bits) {
            Ok(json_string) -> {
              let decoder = {
                use sub <- decode.field("sub", decode.string)
                decode.success(sub)
              }

              json.parse(json_string, decoder)
              |> result.map_error(fn(_) { "id token payload did not include sub" })
            }
            Error(_) -> Error("invalid id token payload")
          }
        Error(_) -> Error("invalid id token payload")
      }
    }
    _ -> Error("invalid id token format")
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

fn random_token() -> String {
  strong_rand_bytes(24)
  |> bit_array.base64_encode(False)
  |> string.replace(each: "+", with: "-")
  |> string.replace(each: "/", with: "_")
  |> string.replace(each: "=", with: "")
}
