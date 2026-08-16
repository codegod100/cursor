//! Classic TCP IRC mini-server using the shared wire codec + hub.
//!
//! ```bash
//! cargo run --example tcp_server -- 127.0.0.1:6667
//! # then: nc 127.0.0.1 6667
//! ```

use erl_irc::hub::Hub;
use erl_irc::stream::ByteStreamIrc;
use futures::StreamExt;
use std::env;

fn main() -> anyhow::Result<()> {
    let bind = env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:6667".to_owned());

    smol::block_on(async {
        let listener = smol::net::TcpListener::bind(&bind).await?;
        println!("erl-irc tcp_server listening on {bind}");
        println!("try: printf 'NICK bob\\r\\nUSER bob 0 * Bob\\r\\nJOIN #demo\\r\\n' | nc {bind}");

        let mut incoming = listener.incoming();
        while let Some(stream) = incoming.next().await.transpose()? {
            let peer = stream.peer_addr()?;
            smol::spawn(async move {
                let mut irc = ByteStreamIrc::new(stream);
                let mut hub = Hub::new("tcp.erl-irc");
                match hub
                    .run_server_side(&mut irc, |ev| {
                        println!("[{peer}] {ev:?}");
                    })
                    .await
                {
                    Ok(()) => println!("[{peer}] disconnected"),
                    Err(e) => println!("[{peer}] error: {e}"),
                }
            })
            .detach();
        }
        Ok(())
    })
}
