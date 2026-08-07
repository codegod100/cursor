use erl_irc::dist::{DistIrc, handshake_pair};
use erl_irc::hub::Hub;
use erl_irc::stream::ByteStreamIrc;
use erl_irc::transport::IrcTransport;
use erl_irc::wire::IrcMessage;

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
