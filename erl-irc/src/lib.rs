//! IRC as a transport-agnostic wire protocol.
//!
//! The IRC message format (RFC 1459 / 2812) is defined once in [`wire`].
//! That codec is independent of how bytes move. Two carriers are provided:
//!
//! - [`stream`] — classic CRLF framing over any `AsyncRead + AsyncWrite`
//! - [`dist`] — IRC lines packed as ETF binaries and sent via [`erl_dist`]
//!   distribution messages (`Creation` + handshake + `reg_send`)
//!
//! Both implement [`transport::IrcTransport`], so a session (see [`hub`]) can
//! speak IRC without caring whether the peer is on TCP or an Erlang node link.

pub mod dist;
pub mod hub;
pub mod stream;
pub mod transport;
pub mod wire;

pub use dist::{DistIrc, DistIrcError};
pub use hub::{Hub, HubEvent};
pub use stream::{ByteStreamIrc, StreamIrcError};
pub use transport::IrcTransport;
pub use wire::{IrcMessage, WireError};
