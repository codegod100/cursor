use erl_dist::LOWEST_DISTRIBUTION_PROTOCOL_VERSION;
use erl_dist::handshake::{ClientSideHandshake, HandshakeStatus, ServerSideHandshake};
use erl_dist::node::{Creation, LocalNode};
use erl_irc::dist::{DistIrc, handshake_pair};
use erl_irc::hub::Hub;
use erl_irc::quic::{client_endpoint, connect_bidi, server_endpoint};
use erl_irc::stream::ByteStreamIrc;
use erl_irc::transport::IrcTransport;
use erl_irc::wire::IrcMessage;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Once;

#[test]
fn wire_roundtrips() {
    let samples = [
        "NICK alice",
        ":server 001 alice :Welcome",
        "@msgid=1 :bob!b@h PRIVMSG #c :hello world",
        "PING :12345",
    ];
    for s in samples {
        let parsed = IrcMessage::parse(s).unwrap();
        let again = IrcMessage::parse(&parsed.format()).unwrap();
        assert_eq!(parsed.command, again.command);
        assert_eq!(parsed.params, again.params);
        assert_eq!(parsed.prefix, again.prefix);
    }
}

#[test]
fn byte_stream_irc_over_tcp_pair() {
    smol::block_on(async {
        let listener = smol::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let client = smol::net::TcpStream::connect(addr).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();

        let mut server_irc = ByteStreamIrc::new(server);
        let mut client_irc = ByteStreamIrc::new(client);

        let server = smol::spawn(async move {
            let mut hub = Hub::new("test.local");
            hub.run_server_side(&mut server_irc, |_| {}).await
        });

        client_irc
            .send(IrcMessage::new("NICK", ["zoe"]))
            .await
            .unwrap();
        client_irc
            .send(IrcMessage::new("USER", ["zoe", "0", "*", "Zoe"]))
            .await
            .unwrap();

        let welcome = client_irc.recv().await.unwrap();
        assert_eq!(welcome.command, "001");

        client_irc
            .send(IrcMessage::new("QUIT", ["bye"]))
            .await
            .unwrap();
        let _ = server.await;
    });
}

#[test]
fn irc_over_erl_dist_handshake() {
    smol::block_on(async {
        let listener = smol::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let accept = smol::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            stream
        });

        let client_stream = smol::net::TcpStream::connect(addr).await.unwrap();
        let server_stream = accept.await;

        let (client_conn, server_conn, client_node, server_node) = handshake_pair(
            client_stream,
            server_stream,
            "c@127.0.0.1".parse().unwrap(),
            "s@127.0.0.1".parse().unwrap(),
            "test-cookie",
        )
        .await
        .expect("handshake");

        let mut server_irc = DistIrc::new(&server_node, server_conn);
        let mut client_irc = DistIrc::new(&client_node, client_conn);

        let server = smol::spawn(async move {
            let mut hub = Hub::new("dist.test");
            hub.run_server_side(&mut server_irc, |_| {}).await
        });

        client_irc
            .send(IrcMessage::new("NICK", ["dist"]))
            .await
            .unwrap();
        client_irc
            .send(IrcMessage::new("USER", ["dist", "0", "*", "Dist"]))
            .await
            .unwrap();

        let welcome = client_irc.recv().await.unwrap();
        assert_eq!(welcome.command, "001");

        client_irc
            .send(IrcMessage::new("PRIVMSG", ["#x", "over dist"]))
            .await
            .unwrap();
        client_irc
            .send(IrcMessage::new("QUIT", ["done"]))
            .await
            .unwrap();
        let _ = server.await;
    });
}

fn install_crypto() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[test]
fn irc_over_erl_dist_on_quic() {
    install_crypto();
    smol::block_on(async {
        let bind = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
        let (server_ep, server_cert) = server_endpoint(bind).unwrap();
        let addr = server_ep.local_addr().unwrap();

        let server_node = LocalNode::new(
            "s@127.0.0.1".parse().unwrap(),
            Creation::random(),
        );
        let client_node = LocalNode::new(
            "c@127.0.0.1".parse().unwrap(),
            Creation::random(),
        );
        let cookie = "quic-test-cookie";

        let server = {
            let server_node = server_node.clone();
            let cookie = cookie.to_owned();
            smol::spawn(async move {
                let (stream, _) = erl_irc::quic::accept_bidi(&server_ep).await.unwrap();
                let mut hs =
                    ServerSideHandshake::new(stream, server_node.clone(), &cookie);
                let status = if hs.execute_recv_name().await.unwrap().is_some() {
                    HandshakeStatus::Ok
                } else {
                    HandshakeStatus::Named {
                        name: "generated".into(),
                        creation: Creation::random(),
                    }
                };
                let (conn, _) = hs.execute_rest(status).await.unwrap();
                let mut irc = DistIrc::new(&server_node, conn);
                let mut hub = Hub::new("quic.test");
                hub.run_server_side(&mut irc, |_| {}).await
            })
        };

        let client_ep = client_endpoint(
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            Some(&server_cert),
        )
        .unwrap();
        let (stream, _) = connect_bidi(&client_ep, addr, "localhost")
            .await
            .unwrap();

        let mut hs = ClientSideHandshake::new(stream, client_node.clone(), cookie);
        let _ = hs
            .execute_send_name(LOWEST_DISTRIBUTION_PROTOCOL_VERSION)
            .await
            .unwrap();
        let (conn, _) = hs.execute_rest(true).await.unwrap();
        let mut irc = DistIrc::new(&client_node, conn);

        irc.send(IrcMessage::new("NICK", ["q"]))
            .await
            .unwrap();
        irc.send(IrcMessage::new("USER", ["q", "0", "*", "Q"]))
            .await
            .unwrap();
        let welcome = irc.recv().await.unwrap();
        assert_eq!(welcome.command, "001");

        irc.send(IrcMessage::new("PRIVMSG", ["#q", "over quic"]))
            .await
            .unwrap();
        irc.send(IrcMessage::new("QUIT", ["done"]))
            .await
            .unwrap();
        let _ = server.await;
    });
}
