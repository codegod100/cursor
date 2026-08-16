//! Shared transport trait for IRC message I/O.

use crate::wire::IrcMessage;

/// Async carrier for IRC messages.
///
/// Implementations may use CRLF byte streams, Erlang distribution, or any
/// other medium — the session layer only sees [`IrcMessage`] values.
pub trait IrcTransport {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Send one IRC message to the peer.
    fn send(
        &mut self,
        msg: IrcMessage,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send;

    /// Receive the next IRC message from the peer.
    fn recv(
        &mut self,
    ) -> impl std::future::Future<Output = Result<IrcMessage, Self::Error>> + Send;
}
