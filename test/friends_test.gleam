import friends/session.{UserSession}
import friends/store
import gleam/option.{None, Some}
import gleeunit
import gleeunit/should
import simplifile

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
