//! IRC over the Erlang Distribution Protocol ([`erl_dist`]).
//!
//! After a distribution handshake, IRC lines are sent as ETF binaries inside
//! `Message::reg_send` to the registered name `"irc"`. The IRC codec itself is
//! unchanged — only the carrier differs from TCP.
//!
//! Node identity uses [`erl_dist::node::Creation`] (typically
//! [`Creation::random`] or the value returned by EPMD registration).

use eetf::{Atom, Binary, ByteList, Pid, Term};
use erl_dist::message::{Message, Receiver, RecvError, SendError, Sender};
use erl_dist::node::{Creation, LocalNode};
use futures::io::{AsyncRead, AsyncWrite};
use thiserror::Error;

use crate::transport::IrcTransport;
use crate::wire::{IrcMessage, WireError};

/// Registered process name that receives IRC wire lines on a dist link.
pub const IRC_PROCESS: &str = "irc";

/// Errors from the erl_dist IRC carrier.
#[derive(Debug, Error)]
pub enum DistIrcError {
    #[error(transparent)]
    Wire(#[from] WireError),
    #[error("distribution send failed: {0}")]
    Send(String),
    #[error("distribution recv failed: {0}")]
    Recv(String),
    #[error("peer closed the distribution channel")]
    Closed,
    #[error("unexpected distribution message: {0:?}")]
    Unexpected(String),
    #[error("IRC payload was not a binary/string term")]
    BadPayload,
}

impl From<SendError> for DistIrcError {
    fn from(value: SendError) -> Self {
        Self::Send(value.to_string())
    }
}

impl From<RecvError> for DistIrcError {
    fn from(value: RecvError) -> Self {
        match value {
            RecvError::Closed => Self::Closed,
            other => Self::Recv(other.to_string()),
        }
    }
}

/// IRC transport backed by an [`erl_dist`] message channel.
pub struct DistIrc<T> {
    tx: Sender<T>,
    rx: Receiver<T>,
    from_pid: Pid,
    to_name: Atom,
}

impl<T> DistIrc<T>
where
    T: AsyncRead + AsyncWrite + Unpin + Clone,
{
    /// Wrap an already-handshaken distribution channel.
    ///
    /// `creation` is the local node's [`Creation`] used to build the sender pid.
    pub fn new(local: &LocalNode, connection: T) -> Self {
        let flags = local.flags;
        let (tx, rx) = erl_dist::message::channel(connection, flags);
        let from_pid = Pid::new(local.name.to_string(), 0, 0, local.creation.get());
        Self {
            tx,
            rx,
            from_pid,
            to_name: Atom::from(IRC_PROCESS),
        }
    }

    /// Convenience: build a [`LocalNode`] with a random [`Creation`].
    pub fn local_node(name: erl_dist::node::NodeName) -> LocalNode {
        LocalNode::new(name, Creation::random())
    }

    fn term_to_line(term: Term) -> Result<String, DistIrcError> {
        match term {
            Term::Binary(Binary { bytes }) => String::from_utf8(bytes).map_err(|_| DistIrcError::BadPayload),
            Term::ByteList(ByteList { bytes }) => {
                String::from_utf8(bytes).map_err(|_| DistIrcError::BadPayload)
            }
            Term::List(list) if list.elements.is_empty() => Ok(String::new()),
            Term::Atom(atom) => Ok(atom.name),
            _ => Err(DistIrcError::BadPayload),
        }
    }
}

impl<T> IrcTransport for DistIrc<T>
where
    T: AsyncRead + AsyncWrite + Unpin + Clone + Send,
{
    type Error = DistIrcError;

    async fn send(&mut self, msg: IrcMessage) -> Result<(), Self::Error> {
        // Dist carrier: one IRC line per reg_send (no CRLF needed on the wire
        // inside ETF; the stream carrier adds CRLF, this one does not).
        let line = msg.format();
        let term = Binary::from(line.into_bytes()).into();
        let dist_msg = Message::reg_send(self.from_pid.clone(), self.to_name.clone(), term);
        self.tx.send(dist_msg).await?;
        Ok(())
    }

    async fn recv(&mut self) -> Result<IrcMessage, Self::Error> {
        loop {
            let msg = self.rx.recv().await?;
            match msg {
                Message::Tick => {
                    // Keep the link alive; swallow ticks.
                    self.tx.send(Message::Tick).await?;
                }
                Message::RegSend(reg) => {
                    let line = Self::term_to_line(reg.message)?;
                    return Ok(IrcMessage::parse(&line)?);
                }
                Message::Send(send) => {
                    let line = Self::term_to_line(send.message)?;
                    return Ok(IrcMessage::parse(&line)?);
                }
                other => {
                    return Err(DistIrcError::Unexpected(format!("{other:?}")));
                }
            }
        }
    }
}

/// Perform a client/server distribution handshake over a connected stream pair.
///
/// Returns `(client_connection, server_connection, client_node, server_node)`.
/// Uses [`Creation::random`] for both sides — no EPMD required for demos/tests.
pub async fn handshake_pair<C, S>(
    client_stream: C,
    server_stream: S,
    client_name: erl_dist::node::NodeName,
    server_name: erl_dist::node::NodeName,
    cookie: &str,
) -> Result<(C, S, LocalNode, LocalNode), Box<dyn std::error::Error + Send + Sync>>
where
    C: AsyncRead + AsyncWrite + Unpin,
    S: AsyncRead + AsyncWrite + Unpin,
{
    let client_node = LocalNode::new(client_name, Creation::random());
    let server_node = LocalNode::new(server_name, Creation::random());

    let client_hs = {
        let cookie = cookie.to_owned();
        let node = client_node.clone();
        async move {
            let mut hs =
                erl_dist::handshake::ClientSideHandshake::new(client_stream, node, &cookie);
            let _status = hs
                .execute_send_name(erl_dist::LOWEST_DISTRIBUTION_PROTOCOL_VERSION)
                .await?;
            hs.execute_rest(true).await
        }
    };

    let server_hs = {
        let cookie = cookie.to_owned();
        let node = server_node.clone();
        async move {
            let mut hs =
                erl_dist::handshake::ServerSideHandshake::new(server_stream, node, &cookie);
            let status = if hs.execute_recv_name().await?.is_some() {
                erl_dist::handshake::HandshakeStatus::Ok
            } else {
                erl_dist::handshake::HandshakeStatus::Named {
                    name: "generated".to_owned(),
                    creation: Creation::random(),
                }
            };
            hs.execute_rest(status).await
        }
    };

    let (client_res, server_res) = futures::future::join(client_hs, server_hs).await;
    let (client_conn, _peer) = client_res?;
    let (server_conn, _peer) = server_res?;
    Ok((client_conn, server_conn, client_node, server_node))
}
