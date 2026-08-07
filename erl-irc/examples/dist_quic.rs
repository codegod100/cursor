//! IRC over `erl_dist` carried on **QUIC** (not TCP).
//!
//! Same IRC session as `dist_peers`, but the distribution handshake and
//! `reg_send` frames ride a Quinn bidirectional stream.
//!
//! ```bash
//! cargo run --example dist_quic
//! ```

use erl_dist::LOWEST_DISTRIBUTION_PROTOCOL_VERSION;
use erl_dist::handshake::{ClientSideHandshake, HandshakeStatus, ServerSideHandshake};
use erl_dist::node::{Creation, LocalNode};
use erl_irc::dist::DistIrc;
use erl_irc::hub::Hub;
use erl_irc::quic::{self, client_endpoint, connect_bidi, server_endpoint};
use erl_irc::transport::IrcTransport;
use erl_irc::wire::IrcMessage;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

fn main() -> anyhow::Result<()> {
    // Install ring crypto provider once for rustls (idempotent-ish).
    let _ = rustls::crypto::ring::default_provider().install_default();

    smol::block_on(async {
        let bind = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
        let (server_ep, server_cert) = server_endpoint(bind)?;
        let addr = server_ep.local_addr()?;
        println!("[quic] server listening on {addr} (ALPN={})", String::from_utf8_lossy(quic::ALPN_ERL_IRC));

        let cookie = "erl-irc-demo-cookie";
        let client_name: erl_dist::node::NodeName = "irc_client@127.0.0.1".parse()?;
        let server_name: erl_dist::node::NodeName = "irc_server@127.0.0.1".parse()?;

        let client_node = LocalNode::new(client_name, Creation::random());
        let server_node = LocalNode::new(server_name, Creation::random());

        let server_task = {
            let server_node = server_node.clone();
            let cookie = cookie.to_owned();
            smol::spawn(async move {
                let (stream, conn) = quic::accept_bidi(&server_ep).await?;
                println!(
                    "[quic server] connection from {}",
                    conn.remote_address()
                );

                let mut hs =
                    ServerSideHandshake::new(stream, server_node.clone(), &cookie);
                let status = if hs.execute_recv_name().await?.is_some() {
                    HandshakeStatus::Ok
                } else {
                    HandshakeStatus::Named {
                        name: "generated".into(),
                        creation: Creation::random(),
                    }
                };
                let (conn_io, peer) = hs.execute_rest(status).await?;
                println!("[dist/quic server] handshake ok with {peer:?}");
                println!(
                    "[dist/quic server] local creation={}",
                    server_node.creation.get()
                );

                let mut irc = DistIrc::new(&server_node, conn_io);
                let mut hub = Hub::new("quic.erl-irc");
                hub.run_server_side(&mut irc, |ev| {
                    println!("[dist/quic server event] {ev:?}");
                })
                .await?;
                Ok::<(), anyhow::Error>(())
            })
        };

        let client_ep = client_endpoint(
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            Some(&server_cert),
        )?;
        let (stream, conn) = connect_bidi(&client_ep, addr, "localhost").await?;
        println!("[quic client] connected to {}", conn.remote_address());

        let mut hs = ClientSideHandshake::new(stream, client_node.clone(), cookie);
        let _status = hs
            .execute_send_name(LOWEST_DISTRIBUTION_PROTOCOL_VERSION)
            .await?;
        let (conn_io, peer) = hs.execute_rest(true).await?;
        println!("[dist/quic client] handshake ok with {peer:?}");
        println!(
            "[dist/quic client] local creation={}",
            client_node.creation.get()
        );

        let mut irc = DistIrc::new(&client_node, conn_io);

        irc.send(IrcMessage::new("NICK", ["quinn"])).await?;
        irc.send(IrcMessage::new("USER", ["quinn", "0", "*", "Quinn"]))
            .await?;

        for _ in 0..4 {
            let msg = irc.recv().await?;
            println!("[dist/quic client <-] {msg}");
        }

        irc.send(IrcMessage::new("JOIN", ["#quic"])).await?;
        loop {
            let msg = irc.recv().await?;
            println!("[dist/quic client <-] {msg}");
            if msg.command == "366" {
                break;
            }
        }

        irc.send(IrcMessage::new(
            "PRIVMSG",
            ["#quic", "hello over erl_dist on QUIC"],
        ))
        .await?;
        irc.send(IrcMessage::new("QUIT", ["done"])).await?;

        let _ = server_task.await?;
        client_ep.close(0u32.into(), b"bye");
        Ok(())
    })
}
