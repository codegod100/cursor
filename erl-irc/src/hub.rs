//! Minimal IRC session logic shared across transports.
//!
//! Speaks enough of IRC for a demo: NICK/USER registration, PING/PONG,
//! JOIN, and PRIVMSG echo/relay hooks via [`HubEvent`].

use crate::transport::IrcTransport;
use crate::wire::IrcMessage;

/// Events emitted by [`Hub`] for the application to observe or relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HubEvent {
    Registered { nick: String },
    Joined { channel: String },
    Privmsg { target: String, text: String },
    Quit,
}

/// Tiny IRC peer/session state machine.
#[derive(Debug, Default)]
pub struct Hub {
    pub nick: Option<String>,
    pub user: Option<String>,
    pub channels: Vec<String>,
    server_name: String,
}

impl Hub {
    pub fn new(server_name: impl Into<String>) -> Self {
        Self {
            server_name: server_name.into(),
            ..Self::default()
        }
    }

    pub fn is_registered(&self) -> bool {
        self.nick.is_some() && self.user.is_some()
    }

    /// Handle one inbound IRC message; may enqueue outbound replies.
    pub fn handle(&mut self, msg: &IrcMessage) -> (Vec<IrcMessage>, Option<HubEvent>) {
        let mut out = Vec::new();
        let event = match msg.command.as_str() {
            "NICK" => {
                if let Some(nick) = msg.params.first() {
                    self.nick = Some(nick.clone());
                    if self.is_registered() {
                        out.extend(self.welcome());
                        Some(HubEvent::Registered {
                            nick: nick.clone(),
                        })
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            "USER" => {
                self.user = msg.params.first().cloned();
                if self.is_registered() {
                    let nick = self.nick.clone().unwrap_or_default();
                    out.extend(self.welcome());
                    Some(HubEvent::Registered { nick })
                } else {
                    None
                }
            }
            "PING" => {
                let token = msg.params.first().map(String::as_str).unwrap_or("erl-irc");
                out.push(IrcMessage::new("PONG", [self.server_name.as_str(), token]));
                None
            }
            "JOIN" => {
                if let Some(channel) = msg.params.first() {
                    if !self.channels.iter().any(|c| c.eq_ignore_ascii_case(channel)) {
                        self.channels.push(channel.clone());
                    }
                    if let Some(nick) = &self.nick {
                        out.push(IrcMessage::with_prefix(
                            format!("{nick}!{nick}@erl-irc"),
                            "JOIN",
                            [channel.as_str()],
                        ));
                        out.push(IrcMessage::with_prefix(
                            &self.server_name,
                            "332",
                            [nick.as_str(), channel.as_str(), "erl-irc demo channel"],
                        ));
                        out.push(IrcMessage::with_prefix(
                            &self.server_name,
                            "353",
                            [nick.as_str(), "=", channel.as_str(), nick.as_str()],
                        ));
                        out.push(IrcMessage::with_prefix(
                            &self.server_name,
                            "366",
                            [nick.as_str(), channel.as_str(), "End of /NAMES list"],
                        ));
                    }
                    Some(HubEvent::Joined {
                        channel: channel.clone(),
                    })
                } else {
                    None
                }
            }
            "PRIVMSG" => {
                let target = msg.params.first().cloned().unwrap_or_default();
                let text = msg.trailing().unwrap_or("").to_string();
                Some(HubEvent::Privmsg { target, text })
            }
            "QUIT" | "QUIT\r" => Some(HubEvent::Quit),
            _ => None,
        };
        (out, event)
    }

    fn welcome(&self) -> Vec<IrcMessage> {
        let nick = self.nick.clone().unwrap_or_else(|| "*".into());
        vec![
            IrcMessage::with_prefix(
                &self.server_name,
                "001",
                [nick.clone(), format!("Welcome to erl-irc, {nick}")],
            ),
            IrcMessage::with_prefix(
                &self.server_name,
                "002",
                [
                    nick.clone(),
                    "Your host is erl-irc, running IRC over pluggable transports".into(),
                ],
            ),
            IrcMessage::with_prefix(
                &self.server_name,
                "003",
                [nick.clone(), "This server was created for demos".into()],
            ),
            IrcMessage::with_prefix(
                &self.server_name,
                "004",
                [
                    nick,
                    self.server_name.clone(),
                    "erl-irc-0.1".into(),
                    "o".into(),
                    "o".into(),
                ],
            ),
        ]
    }

    /// Drive a full request/response loop until quit or transport error.
    pub async fn run_server_side<T: IrcTransport>(
        &mut self,
        transport: &mut T,
        mut on_event: impl FnMut(HubEvent),
    ) -> Result<(), T::Error> {
        loop {
            let msg = transport.recv().await?;
            let (replies, event) = self.handle(&msg);
            for reply in replies {
                transport.send(reply).await?;
            }
            if let Some(ev) = event {
                let quit = matches!(ev, HubEvent::Quit);
                on_event(ev);
                if quit {
                    break;
                }
            }
        }
        Ok(())
    }
}
