# erl-irc

Example project: **IRC as a transport-agnostic wire protocol**, carried either
over classic byte streams or over the [Erlang Distribution Protocol] via
[`erl_dist`].

```
┌──────────────────────────────────────────┐
│         IRC wire codec (RFC 1459)        │  erl_irc::wire
├────────────────────┬─────────────────────┤
│  CRLF byte stream  │  erl_dist reg_send  │
│  (TCP / duplex)    │  (ETF binary lines) │
└────────────────────┴─────────────────────┘
```

The IRC parser/formatter never opens a socket. Session logic (`Hub`) only
speaks [`IrcTransport`]. Swap the carrier without changing message handling.

## Why `erl_dist`?

[`erl_dist`] already treats distribution as framing over any
`AsyncRead + AsyncWrite`. This crate mirrors that idea for IRC, then plugs
IRC **into** `erl_dist`: after a handshake (using
[`Creation`](https://docs.rs/erl_dist/latest/erl_dist/node/struct.Creation.html)
from `Creation::random()` or EPMD registration), each IRC line is an ETF
`Binary` inside `Message::reg_send` to the registered name `"irc"`.

## Layout

| Module | Role |
|--------|------|
| `wire` | Parse / format IRC lines (no I/O) |
| `transport` | `IrcTransport` trait |
| `stream` | CRLF framing over async byte streams |
| `dist` | IRC over `erl_dist` channels |
| `hub` | Tiny NICK/USER/JOIN/PRIVMSG/PING demo session |

## Examples

```bash
cd erl-irc

# Same IRC codec over a localhost TCP pair (byte-stream carrier)
cargo run --example duplex_chat

# Listen like a classic IRC daemon
cargo run --example tcp_server -- 127.0.0.1:6667

# Handshake two nodes with erl_dist, then speak IRC on the dist channel
cargo run --example dist_peers
```

## Library sketch

```rust
use erl_irc::stream::ByteStreamIrc;
use erl_irc::transport::IrcTransport;
use erl_irc::wire::IrcMessage;

// Any AsyncRead + AsyncWrite works — TcpStream, TLS, pipes, …
async fn ping<T>(mut irc: ByteStreamIrc<T>) -> Result<(), Box<dyn std::error::Error>>
where
    T: futures::io::AsyncRead + futures::io::AsyncWrite + Unpin + Send,
{
    irc.send(IrcMessage::new("PING", ["erl-irc"])).await?;
    let pong = irc.recv().await?;
    assert_eq!(pong.command, "PONG");
    Ok(())
}
```

For distribution:

```rust
use erl_dist::node::{Creation, LocalNode};
use erl_irc::dist::DistIrc;

let local = LocalNode::new("chat@127.0.0.1".parse()?, Creation::random());
// … ClientSideHandshake / ServerSideHandshake …
let mut irc = DistIrc::new(&local, connection);
irc.send(IrcMessage::new("PRIVMSG", ["#room", "hi"])).await?;
```

## Tests

```bash
cargo test
```

[Erlang Distribution Protocol]: https://www.erlang.org/doc/apps/erts/erl_dist_protocol.html
[`erl_dist`]: https://docs.rs/erl_dist
