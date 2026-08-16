//! Classic IRC framing over any async byte stream.
//!
//! Same wire text as a TCP IRC daemon — CRLF-terminated lines — but the
//! underlying type is only required to be `AsyncRead + AsyncWrite + Unpin`.

use futures::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use futures::io::{AsyncRead, AsyncWrite};
use thiserror::Error;

use crate::transport::IrcTransport;
use crate::wire::{IrcMessage, WireError};

/// Errors from the byte-stream IRC carrier.
#[derive(Debug, Error)]
pub enum StreamIrcError {
    #[error(transparent)]
    Wire(#[from] WireError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("peer closed the connection")]
    Closed,
}

/// IRC over a generic async byte stream (TCP, TLS, in-memory duplex, …).
pub struct ByteStreamIrc<T> {
    reader: BufReader<futures::io::ReadHalf<T>>,
    writer: futures::io::WriteHalf<T>,
    line_buf: String,
}

impl<T> ByteStreamIrc<T>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    /// Split `stream` into buffered reader + writer halves.
    pub fn new(stream: T) -> Self {
        let (reader, writer) = futures::io::AsyncReadExt::split(stream);
        Self {
            reader: BufReader::new(reader),
            writer,
            line_buf: String::new(),
        }
    }
}

impl<T> IrcTransport for ByteStreamIrc<T>
where
    T: AsyncRead + AsyncWrite + Unpin + Send,
{
    type Error = StreamIrcError;

    async fn send(&mut self, msg: IrcMessage) -> Result<(), Self::Error> {
        let line = msg.format_crlf();
        self.writer.write_all(line.as_bytes()).await?;
        self.writer.flush().await?;
        Ok(())
    }

    async fn recv(&mut self) -> Result<IrcMessage, Self::Error> {
        self.line_buf.clear();
        let n = self.reader.read_line(&mut self.line_buf).await?;
        if n == 0 {
            return Err(StreamIrcError::Closed);
        }
        Ok(IrcMessage::parse(&self.line_buf)?)
    }
}
