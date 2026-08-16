//! IRC as a transport-agnostic wire protocol.
//!
//! The IRC message format (RFC 1459 / 2812) is defined once in [`wire`].
//! That codec is independent of how bytes move. Carriers include:
//!
//! - [`stream`] — classic CRLF framing over any `AsyncRead + AsyncWrite`
//! - [`dist`] — IRC lines packed as ETF binaries and sent via [`erl_dist`]
//!   distribution messages (`Creation` + handshake + `reg_send`)
//! - [`quic`] — Quinn bidirectional streams (cloneable) for use under either
//!   carrier — e.g. `erl_dist` over QUIC instead of TCP
//!
//! Session logic ([`hub`]) only speaks [`transport::IrcTransport`].

pub mod dist;
pub mod hub;
pub mod quic;
pub mod stream;
pub mod transport;
pub mod wire;

pub use dist::{DistIrc, DistIrcError};
pub use hub::{Hub, HubEvent};
pub use quic::{QuicBidi, QuicError, SharedQuicStream};
pub use stream::{ByteStreamIrc, StreamIrcError};
pub use transport::IrcTransport;
pub use wire::{IrcMessage, WireError};
