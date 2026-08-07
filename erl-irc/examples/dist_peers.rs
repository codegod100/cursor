//! IRC over Erlang distribution (`erl_dist`).
//!
//! Two local nodes complete a distribution handshake (using
//! [`erl_dist::node::Creation::random`]), then exchange the **same** IRC
//! messages as the TCP example — but packed as ETF binaries inside
//! `reg_send` on the dist channel.
//!
//! ```bash
//! cargo run --example dist_peers
//! ```

use erl_dist::LOWEST_DISTRIBUTION_PROTOCOL_VERSION;
use erl_dist::handshake::{ClientSideHandshake, HandshakeStatus, ServerSideHandshake};
use erl_dist::node::{Creation, LocalNode};
use erl_irc::dist::DistIrc;
use erl_irc::hub::Hub;
use erl_irc::transport::IrcTransport;
use erl_irc::wire::IrcMessage;

fn main() -> anyhow::Result<()> {
    smol::block_on(async {
        let listener = smol::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;

        let cookie = "erl-irc-demo-cookie";
        let client_name: erl_dist::node::NodeName = "irc_client@127.0.0.1".parse()?;
        let server_name: erl_dist::node::NodeName = "irc_server@127.0.0.1".parse()?;

        let client_node = LocalNode::new(client_name.clone(), Creation::random());
        let server_node = LocalNode::new(server_name.clone(), Creation::random());

        let server_task = {
            let server_node = server_node.clone();
            let cookie = cookie.to_owned();
            smol::spawn(async move {
                let (stream, _) = listener.accept().await?;
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
                let (conn, peer) = hs.execute_rest(status).await?;
                println!("[dist server] handshake ok with {peer:?}");
                println!(
                    "[dist server] local creation={}",
                    server_node.creation.get()
                );

                let mut irc = DistIrc::new(&server_node, conn);
                let mut hub = Hub::new("dist.erl-irc");
                hub.run_server_side(&mut irc, |ev| {
                    println!("[dist server event] {ev:?}");
                })
                .await?;
                Ok::<(), anyhow::Error>(())
            })
        };

        let stream = smol::net::TcpStream::connect(addr).await?;
        let mut hs = ClientSideHandshake::new(stream, client_node.clone(), cookie);
        let _status = hs
            .execute_send_name(LOWEST_DISTRIBUTION_PROTOCOL_VERSION)
            .await?;
        let (conn, peer) = hs.execute_rest(true).await?;
        println!("[dist client] handshake ok with {peer:?}");
        println!(
            "[dist client] local creation={}",
            client_node.creation.get()
        );

        let mut irc = DistIrc::new(&client_node, conn);

        irc.send(IrcMessage::new("NICK", ["carol"])).await?;
        irc.send(IrcMessage::new("USER", ["carol", "0", "*", "Carol"]))
            .await?;

        for _ in 0..4 {
            let msg = irc.recv().await?;
            println!("[dist client <-] {msg}");
        }

        irc.send(IrcMessage::new("JOIN", ["#dist"])).await?;
        loop {
            let msg = irc.recv().await?;
            println!("[dist client <-] {msg}");
            if msg.command == "366" {
                break;
            }
        }

        irc.send(IrcMessage::new(
            "PRIVMSG",
            ["#dist", "hello over erl_dist"],
        ))
        .await?;
        irc.send(IrcMessage::new("QUIT", ["done"])).await?;

        let _ = server_task.await?;
        Ok(())
    })
}
