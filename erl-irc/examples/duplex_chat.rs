//! Two IRC peers over an in-memory-style localhost TCP pair.
//!
//! Same [`ByteStreamIrc`] framing a real IRC daemon uses — CRLF lines —
//! proving the codec does not care what provides `AsyncRead + AsyncWrite`.
//!
//! ```bash
//! cargo run --example duplex_chat
//! ```

use erl_irc::hub::Hub;
use erl_irc::stream::ByteStreamIrc;
use erl_irc::transport::IrcTransport;
use erl_irc::wire::IrcMessage;

fn main() -> anyhow::Result<()> {
    smol::block_on(async {
        let listener = smol::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let client = smol::net::TcpStream::connect(addr).await?;
        let (server, _) = listener.accept().await?;

        let mut server_irc = ByteStreamIrc::new(server);
        let mut client_irc = ByteStreamIrc::new(client);

        let server_task = smol::spawn(async move {
            let mut hub = Hub::new("duplex.local");
            hub.run_server_side(&mut server_irc, |ev| {
                println!("[server event] {ev:?}");
            })
            .await
        });

        client_irc
            .send(IrcMessage::new("NICK", ["alice"]))
            .await?;
        client_irc
            .send(IrcMessage::new("USER", ["alice", "0", "*", "Alice"]))
            .await?;

        for _ in 0..4 {
            let msg = client_irc.recv().await?;
            println!("[client <-] {msg}");
        }

        client_irc
            .send(IrcMessage::new("JOIN", ["#demo"]))
            .await?;
        loop {
            let msg = client_irc.recv().await?;
            println!("[client <-] {msg}");
            if msg.command == "366" {
                break;
            }
        }

        client_irc
            .send(IrcMessage::new(
                "PRIVMSG",
                ["#demo", "hello over a byte stream"],
            ))
            .await?;
        client_irc.send(IrcMessage::new("QUIT", ["bye"])).await?;

        let _ = server_task.await;
        Ok(())
    })
}
