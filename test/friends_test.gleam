import friends/auth
import friends/bluesky.{Post, ReplyTo}
import friends/config
import friends/feed
import friends/pending as friends_pending
import friends/session.{UserSession}
import friends/store
import gleam/http
import gleam/option.{None, Some}
import gleam/string
import gleeunit
import gleeunit/should
import simplifile
import wisp
import wisp/simulate

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn session_round_trip_with_name_test() {
  let original = UserSession(sub: "user-1", name: Some("Ada"))
  let assert Ok(decoded) = session.decode(session.encode(original))
  decoded
  |> should.equal(original)
}

pub fn session_round_trip_with_null_name_test() {
  let original = UserSession(sub: "user-2", name: None)
  let assert Ok(decoded) = session.decode(session.encode(original))
  decoded
  |> should.equal(original)
}

pub fn session_decode_missing_name_test() {
  let assert Ok(decoded) = session.decode("{\"sub\":\"user-3\"}")
  decoded
  |> should.equal(UserSession(sub: "user-3", name: None))
}

pub fn session_cookie_survives_follow_up_request_test() {
  let user = UserSession(sub: "user-4", name: Some("Ada"))
  let request = simulate.browser_request(http.Get, "/auth/callback")
  let response =
    wisp.response(200)
    |> session.write(request, user)

  let next =
    simulate.browser_request(http.Get, "/")
    |> simulate.session(request, response)

  session.read(next)
  |> should.equal(Some(user))
}

fn test_config() -> config.Config {
  config.Config(
    port: 8000,
    base_url: "https://friends.boxd.sh",
    secret_key_base: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    data_path: "data/handles.json",
    oidc_issuer: "https://id.openbao.boxd.sh",
    oidc_client_id: "client",
    oidc_client_secret: "secret",
    oidc_redirect_uri: "https://friends.boxd.sh/auth/callback",
    websocket_path: "/live",
  )
}

pub fn oauth_state_round_trip_test() {
  let conf = test_config()
  let state = auth.mint_state(conf)

  auth.verify_state(conf, state)
  |> should.be_ok

  auth.verify_state(conf, state <> "tampered")
  |> should.be_error
}

pub fn pending_login_ticket_round_trip_test() {
  let path = "/tmp/friends-test-handles-pending.json"
  let user = UserSession(sub: "user-5", name: Some("Ada"))
  let assert Ok(ticket) = friends_pending.issue(path, user)
  let assert Ok(taken) = friends_pending.take(path, ticket)
  taken
  |> should.equal(user)

  friends_pending.take(path, ticket)
  |> should.be_error
}

pub fn normalize_handle_strips_at_sign_test() {
  store.normalize_handle("@Alice.Bsky.Social")
  |> should.equal("alice.bsky.social")
}

pub fn valid_handle_requires_domain_test() {
  store.valid_handle("alice.bsky.social")
  |> should.be_true

  store.valid_handle("not-a-handle")
  |> should.be_false
}

pub fn add_and_remove_handle_round_trip_test() {
  let path = "/tmp/friends-test-handles.json"
  let _ = simplifile.delete(path)
  let initial = store.open(path)

  let assert Ok(#(with_handle, True)) =
    store.add_handle(initial, "user-1", "alice.bsky.social")

  store.handles(with_handle, "user-1")
  |> should.equal(["alice.bsky.social"])

  let assert Ok(#(without_handle, True)) =
    store.remove_handle(with_handle, "user-1", "alice.bsky.social")

  store.handles(without_handle, "user-1")
  |> should.equal([])

  let _ = simplifile.delete(path)
}

pub fn atom_reply_body_includes_original_test() {
  let post =
    Post(
      uri: "at://did:example/app.bsky.feed.post/reply",
      text: "pretty much",
      created_at: "2026-08-05T00:00:00.000Z",
      author_handle: "nandi.uk",
      author_name: Some("nandi"),
      web_url: "https://bsky.app/profile/nandi.uk/post/reply",
      reply_to: Some(ReplyTo(
        text: "ATProto webcomics what/how",
        author_handle: "danhon.com",
        author_name: None,
      )),
    )

  let html = feed.entry_content_html(post)
  string_contains(html, "In reply to @danhon.com")
  |> should.be_true
  string_contains(html, "ATProto webcomics what/how")
  |> should.be_true
  string_contains(html, "pretty much")
  |> should.be_true
}

fn string_contains(haystack: String, needle: String) -> Bool {
  case string.split(haystack, needle) {
    [_] -> False
    _ -> True
  }
}

pub fn all_handles_unions_users_test() {
  let path = "/tmp/friends-test-handles-all.json"
  let _ = simplifile.delete(path)
  let initial = store.open(path)

  let assert Ok(#(with_alice, True)) =
    store.add_handle(initial, "user-1", "alice.bsky.social")
  let assert Ok(#(with_both, True)) =
    store.add_handle(with_alice, "user-2", "bob.bsky.social")
  let assert Ok(#(with_shared, True)) =
    store.add_handle(with_both, "user-2", "alice.bsky.social")

  store.all_handles(with_shared)
  |> should.equal(["alice.bsky.social", "bob.bsky.social"])

  let _ = simplifile.delete(path)
}
