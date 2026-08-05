//// Application routes and request dispatch.

import friends/auth
import friends/config.{type Config}
import friends/feed
import friends/html
import friends/http_adapter
import friends/session
import friends/store
import friends/views/home
import gleam/http
import gleam/bit_array
import gleam/http/response
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import gleam/uri
import lightspeed/framework/controller
import lightspeed/framework/endpoint
import lightspeed/framework/http as ls_http
import lightspeed/framework/verified_routes as routes
import lightspeed/transport/contract
import wisp

pub type App {
  App(config: Config)
}

pub fn new(config: Config) -> App {
  App(config:)
}

pub fn handle(app: App, request: wisp.Request) -> wisp.Response {
  case request.method, request.path {
    http.Post, "/handles" -> add_handle(app, request)
    http.Post, path -> {
      case is_delete_handle_path(path) {
        True -> delete_handle(app, request, path)
        False -> dispatch_lightspeed(app, request)
      }
    }
    _, _ -> dispatch_lightspeed(app, request)
  }
}

fn is_delete_handle_path(path: String) -> Bool {
  string.starts_with(path, "/handles/") && string.ends_with(path, "/delete")
}

fn dispatch_lightspeed(app: App, request: wisp.Request) -> wisp.Response {
  let lightspeed_request = http_adapter.from_wisp(request)
  let lightspeed_response =
    endpoint.call(endpoint_for(app, request), lightspeed_request)
  http_adapter.to_wisp(request, lightspeed_response)
}

fn endpoint_for(app: App, request: wisp.Request) -> endpoint.Endpoint {
  let flash = read_flash(request)

  endpoint.new(auth_hook(), app.config.websocket_path)
  |> endpoint.get_live(routes.route0("/"), "home", fn(_conn) {
    home.render(
      app.config,
      session.read(request),
      store.open(app.config.data_path),
      flash,
    )
  })
  |> endpoint.get_controller(routes.route0("/feed.atom"), fn(conn) {
    serve_feed(app, conn, request)
  })
  |> endpoint.get_controller(routes.route0("/auth/login"), fn(conn) {
    login(app, conn, request)
  })
  |> endpoint.get_controller(routes.route0("/auth/callback"), fn(conn) {
    callback(app, conn, request)
  })
  |> endpoint.get_controller(routes.route0("/auth/logout"), fn(conn) {
    logout(conn, request)
  })
}

fn auth_hook() -> contract.AuthHook {
  contract.allow_all("friends")
}

fn serve_feed(app: App, conn: ls_http.Conn, request: wisp.Request) -> ls_http.Conn {
  case session.read(request) {
    None -> controller.redirect(conn, "/auth/login")
    Some(user) -> {
      let current = store.open(app.config.data_path)
      case feed.build_atom(app.config, current, user.sub) {
        Ok(body) ->
          ls_http.send(
            conn,
            200,
            "application/atom+xml; charset=utf-8",
            body,
          )
          |> ls_http.put_header("cache-control", "public, max-age=300")

        Error(reason) ->
          ls_http.send(conn, 400, "text/plain; charset=utf-8", reason)
      }
    }
  }
}

fn login(app: App, conn: ls_http.Conn, request: wisp.Request) -> ls_http.Conn {
  case session.read(request) {
    Some(_) -> controller.redirect(conn, "/")
    None -> from_wisp_response(conn, auth.login_redirect(app.config, request))
  }
}

fn callback(app: App, conn: ls_http.Conn, request: wisp.Request) -> ls_http.Conn {
  case auth.callback(app.config, request) {
    Ok(#(_user, response)) -> from_wisp_response(conn, response)
    Error(reason) ->
      controller.html(
        conn,
        html.page(
          "Sign in failed",
          "<p>Could not complete sign in: "
            <> html.escape_text(reason)
            <> "</p><p><a href=\"/auth/login\">Try again</a></p>",
        ),
      )
  }
}

fn logout(conn: ls_http.Conn, request: wisp.Request) -> ls_http.Conn {
  from_wisp_response(conn, auth.logout(request))
}

fn add_handle(app: App, request: wisp.Request) -> wisp.Response {
  case session.read(request) {
    None -> wisp.redirect("/auth/login")
    Some(user) -> {
      let form = parse_form(request)
      case list.key_find(form, "handle") {
        Ok(handle) -> {
          let current = store.open(app.config.data_path)
          case store.add_handle(current, user.sub, handle) {
            Ok(#(_next, added)) -> {
              let message = case added {
                True -> "Added @" <> store.normalize_handle(handle)
                False -> "Handle is already on your list"
              }
              redirect_with_flash(request, message)
            }
            Error(reason) -> redirect_with_flash(request, reason)
          }
        }
        Error(_) -> redirect_with_flash(request, "missing handle")
      }
    }
  }
}

fn delete_handle(
  app: App,
  request: wisp.Request,
  path: String,
) -> wisp.Response {
  let encoded_handle =
    path
    |> string.drop_start(up_to: 9)
    |> string.drop_end(up_to: 7)

  let handle =
    uri.percent_decode(encoded_handle)
    |> result.unwrap(encoded_handle)

  case session.read(request) {
    None -> wisp.redirect("/auth/login")
    Some(user) -> {
      let current = store.open(app.config.data_path)
      case store.remove_handle(current, user.sub, handle) {
        Ok(#(_next, _removed)) ->
          redirect_with_flash(request, "Removed @" <> handle)
        Error(reason) -> redirect_with_flash(request, reason)
      }
    }
  }
}

fn redirect_with_flash(request: wisp.Request, message: String) -> wisp.Response {
  wisp.redirect("/")
  |> wisp.set_cookie(request, "friends_flash", message, wisp.Signed, 60)
}

fn read_flash(request: wisp.Request) -> Option(String) {
  case wisp.get_cookie(request, "friends_flash", wisp.Signed) {
    Ok(message) -> Some(message)
    Error(_) -> None
  }
}

fn from_wisp_response(conn: ls_http.Conn, response: wisp.Response) -> ls_http.Conn {
  let body = case response.body {
    wisp.Text(text) -> text
    wisp.Bytes(_) -> ""
    wisp.File(..) -> ""
  }

  let conn =
    conn
  |> ls_http.set_status(response.status)
  |> ls_http.set_body(body)

  list.fold(response.headers, conn, fn(acc, header) {
    let #(key, value) = header
    ls_http.put_header(acc, key, value)
  })
}

fn parse_form(request: wisp.Request) -> List(#(String, String)) {
  case wisp.read_body_bits(request) {
    Ok(bits) ->
      case bit_array.to_string(bits) {
        Ok(text) -> uri.parse_query(text) |> result.unwrap([])
        Error(_) -> []
      }
    Error(_) -> []
  }
}
