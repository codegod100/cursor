//! QUIC byte-stream helpers for transport-agnostic IRC / `erl_dist`.
//!
//! Quinn bidirectional streams are adapted to
//! `futures::io::{AsyncRead, AsyncWrite}` and wrapped so they are **`Clone`**,
//! which [`erl_dist::message::channel`] requires (same as `TcpStream`).
//!
//! Demo TLS uses a self-signed cert; clients skip verification. Fine for
//! examples/tests — not for production.

use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use async_dup::Mutex as DupMutex;
use futures::io::{AsyncRead, AsyncWrite};
use quinn::{ClientConfig, Connection, Endpoint, RecvStream, SendStream, ServerConfig};
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use thiserror::Error;

/// ALPN protocol id for erl-irc over QUIC.
pub const ALPN_ERL_IRC: &[u8] = b"erl-irc";

/// Errors from QUIC setup / streaming.
#[derive(Debug, Error)]
pub enum QuicError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Connect(#[from] quinn::ConnectError),
    #[error(transparent)]
    Connection(#[from] quinn::ConnectionError),
    #[error("QUIC TLS config: {0}")]
    Tls(String),
    #[error("no bidirectional stream available")]
    NoStream,
}

/// Cloneable QUIC bidi stream usable with [`crate::dist::DistIrc`] and
/// [`crate::stream::ByteStreamIrc`].
pub type SharedQuicStream = async_dup::Arc<DupMutex<QuicBidi>>;

/// Quinn send+recv halves as one async byte stream.
pub struct QuicBidi {
    send: SendStream,
    recv: RecvStream,
}

impl QuicBidi {
    pub fn new(send: SendStream, recv: RecvStream) -> Self {
        Self { send, recv }
    }

    /// Wrap so [`erl_dist`] channels can clone the handle.
    pub fn shared(self) -> SharedQuicStream {
        async_dup::Arc::new(DupMutex::new(self))
    }
}

impl AsyncRead for QuicBidi {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut [u8],
    ) -> Poll<std::io::Result<usize>> {
        AsyncRead::poll_read(Pin::new(&mut self.recv), cx, buf)
    }
}

impl AsyncWrite for QuicBidi {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        AsyncWrite::poll_write(Pin::new(&mut self.send), cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        AsyncWrite::poll_flush(Pin::new(&mut self.send), cx)
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        AsyncWrite::poll_close(Pin::new(&mut self.send), cx)
    }
}

/// Self-signed server material for demos.
pub struct DemoCert {
    pub cert_der: CertificateDer<'static>,
    pub key_der: PrivatePkcs8KeyDer<'static>,
}

impl DemoCert {
    pub fn generate(server_name: &str) -> Result<Self, QuicError> {
        let certified = rcgen::generate_simple_self_signed(vec![server_name.to_owned()])
            .map_err(|e| QuicError::Tls(e.to_string()))?;
        Ok(Self {
            cert_der: CertificateDer::from(certified.cert),
            key_der: PrivatePkcs8KeyDer::from(certified.signing_key.serialize_der()),
        })
    }
}

/// QUIC server endpoint with a self-signed cert (returns cert DER for clients).
pub fn server_endpoint(
    bind: SocketAddr,
) -> Result<(Endpoint, CertificateDer<'static>), QuicError> {
    let demo = DemoCert::generate("localhost")?;
    let mut server_crypto = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![demo.cert_der.clone()], demo.key_der.into())
        .map_err(|e| QuicError::Tls(e.to_string()))?;
    server_crypto.alpn_protocols = vec![ALPN_ERL_IRC.to_vec()];

    let mut server_config = ServerConfig::with_crypto(Arc::new(
        quinn::crypto::rustls::QuicServerConfig::try_from(server_crypto)
            .map_err(|e| QuicError::Tls(e.to_string()))?,
    ));
    let transport = Arc::get_mut(&mut server_config.transport).expect("unique transport");
    transport.max_concurrent_uni_streams(0u8.into());

    let endpoint = Endpoint::server(server_config, bind)?;
    Ok((endpoint, demo.cert_der))
}

/// QUIC client endpoint that trusts a specific server cert DER (demo) or skips verify.
pub fn client_endpoint(
    bind: SocketAddr,
    server_cert: Option<&CertificateDer<'static>>,
) -> Result<Endpoint, QuicError> {
    let mut endpoint = Endpoint::client(bind)?;
    endpoint.set_default_client_config(client_config(server_cert)?);
    Ok(endpoint)
}

fn client_config(server_cert: Option<&CertificateDer<'static>>) -> Result<ClientConfig, QuicError> {
    let mut crypto = if let Some(cert) = server_cert {
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(cert.clone())
            .map_err(|e| QuicError::Tls(e.to_string()))?;
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth()
    } else {
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(SkipServerVerification::new())
            .with_no_client_auth()
    };
    crypto.alpn_protocols = vec![ALPN_ERL_IRC.to_vec()];

    let quic_crypto = quinn::crypto::rustls::QuicClientConfig::try_from(crypto)
        .map_err(|e| QuicError::Tls(e.to_string()))?;
    Ok(ClientConfig::new(Arc::new(quic_crypto)))
}

/// Accept one connection and open (or accept) a single bidirectional stream.
pub async fn accept_bidi(endpoint: &Endpoint) -> Result<(SharedQuicStream, Connection), QuicError> {
    let incoming = endpoint.accept().await.ok_or(QuicError::NoStream)?;
    let conn = incoming.await?;
    // Prefer accepting a client-opened bi stream (client opens in connect_bidi).
    let (send, recv) = conn.accept_bi().await?;
    Ok((QuicBidi::new(send, recv).shared(), conn))
}

/// Connect and open one bidirectional stream.
pub async fn connect_bidi(
    endpoint: &Endpoint,
    addr: SocketAddr,
    server_name: &str,
) -> Result<(SharedQuicStream, Connection), QuicError> {
    let conn = endpoint.connect(addr, server_name)?.await?;
    let (send, recv) = conn.open_bi().await?;
    Ok((QuicBidi::new(send, recv).shared(), conn))
}

#[derive(Debug)]
struct SkipServerVerification(Arc<rustls::crypto::CryptoProvider>);

impl SkipServerVerification {
    fn new() -> Arc<Self> {
        Arc::new(Self(Arc::new(rustls::crypto::ring::default_provider())))
    }
}

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}
