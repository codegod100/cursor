//! Transport-agnostic IRC wire codec (RFC 1459 / RFC 2812 message format).
//!
//! Parsing and formatting never touch sockets — only `&str` / `String`.
//! Transports decide how those lines move.

use std::collections::BTreeMap;
use std::fmt;

use thiserror::Error;

/// Errors while parsing an IRC wire line.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum WireError {
    #[error("empty IRC line")]
    Empty,
    #[error("invalid IRC line: {0}")]
    Invalid(String),
}

/// A single IRC protocol message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrcMessage {
    /// Optional IRCv3 tags (`@key=value;…`).
    pub tags: BTreeMap<String, String>,
    /// Optional origin prefix (`:nick!user@host` or `:server`).
    pub prefix: Option<String>,
    /// Command verb (`NICK`, `PRIVMSG`, `001`, …).
    pub command: String,
    /// Positional parameters; the last may contain spaces (trailing).
    pub params: Vec<String>,
}

impl IrcMessage {
    /// Build a message with no prefix or tags.
    pub fn new(command: impl Into<String>, params: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            tags: BTreeMap::new(),
            prefix: None,
            command: command.into().to_ascii_uppercase(),
            params: params.into_iter().map(Into::into).collect(),
        }
    }

    /// Build a message with a server/user prefix.
    pub fn with_prefix(
        prefix: impl Into<String>,
        command: impl Into<String>,
        params: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let mut msg = Self::new(command, params);
        msg.prefix = Some(prefix.into());
        msg
    }

    /// Parse one IRC line. Accepts optional trailing `\r` / `\n`.
    pub fn parse(line: &str) -> Result<Self, WireError> {
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            return Err(WireError::Empty);
        }

        let mut rest = line;

        let tags = if rest.starts_with('@') {
            let end = rest
                .find(' ')
                .ok_or_else(|| WireError::Invalid("tags without command".into()))?;
            let tag_str = &rest[1..end];
            rest = rest[end + 1..].trim_start();
            parse_tags(tag_str)
        } else {
            BTreeMap::new()
        };

        let prefix = if rest.starts_with(':') {
            let end = rest
                .find(' ')
                .ok_or_else(|| WireError::Invalid("prefix without command".into()))?;
            let pfx = rest[1..end].to_string();
            rest = rest[end + 1..].trim_start();
            Some(pfx)
        } else {
            None
        };

        if rest.is_empty() {
            return Err(WireError::Invalid("missing command".into()));
        }

        let (command, params) = if let Some(space) = rest.find(' ') {
            let command = rest[..space].to_ascii_uppercase();
            let mut rest = &rest[space + 1..];
            let mut params = Vec::new();
            while !rest.is_empty() {
                if let Some(trailing) = rest.strip_prefix(':') {
                    params.push(trailing.to_string());
                    break;
                }
                if let Some(space) = rest.find(' ') {
                    params.push(rest[..space].to_string());
                    rest = &rest[space + 1..];
                } else {
                    params.push(rest.to_string());
                    break;
                }
            }
            (command, params)
        } else {
            (rest.to_ascii_uppercase(), Vec::new())
        };

        if command.is_empty() {
            return Err(WireError::Invalid("empty command".into()));
        }

        Ok(Self {
            tags,
            prefix,
            command,
            params,
        })
    }

    /// Format as an IRC wire line **without** the terminating CRLF.
    pub fn format(&self) -> String {
        let mut out = String::new();

        if !self.tags.is_empty() {
            out.push('@');
            let mut first = true;
            for (key, value) in &self.tags {
                if !first {
                    out.push(';');
                }
                first = false;
                if value.is_empty() {
                    out.push_str(key);
                } else {
                    out.push_str(key);
                    out.push('=');
                    out.push_str(&escape_tag_value(value));
                }
            }
            out.push(' ');
        }

        if let Some(prefix) = &self.prefix {
            out.push(':');
            out.push_str(prefix);
            out.push(' ');
        }

        out.push_str(&self.command);

        for (i, param) in self.params.iter().enumerate() {
            out.push(' ');
            let is_last = i + 1 == self.params.len();
            if is_last && (param.contains(' ') || param.is_empty() || param.starts_with(':')) {
                out.push(':');
            }
            out.push_str(param);
        }

        out
    }

    /// Format with CRLF terminator (classic IRC on a byte stream).
    pub fn format_crlf(&self) -> String {
        let mut s = self.format();
        s.push_str("\r\n");
        s
    }

    /// Convenience: trailing parameter (last param), if any.
    pub fn trailing(&self) -> Option<&str> {
        self.params.last().map(String::as_str)
    }
}

impl fmt::Display for IrcMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.format())
    }
}

fn parse_tags(tag_str: &str) -> BTreeMap<String, String> {
    let mut tags = BTreeMap::new();
    for part in tag_str.split(';') {
        if part.is_empty() {
            continue;
        }
        if let Some((k, v)) = part.split_once('=') {
            tags.insert(k.to_string(), unescape_tag_value(v));
        } else {
            tags.insert(part.to_string(), String::new());
        }
    }
    tags
}

fn escape_tag_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            ';' => out.push_str("\\:"),
            ' ' => out.push_str("\\s"),
            '\\' => out.push_str("\\\\"),
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            other => out.push(other),
        }
    }
    out
}

fn unescape_tag_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some(':') => out.push(';'),
                Some('s') => out.push(' '),
                Some('\\') => out.push('\\'),
                Some('r') => out.push('\r'),
                Some('n') => out.push('\n'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_privmsg() {
        let msg = IrcMessage::with_prefix(
            "alice!a@localhost",
            "PRIVMSG",
            ["#room", "hello world"],
        );
        let line = msg.format();
        assert_eq!(line, ":alice!a@localhost PRIVMSG #room :hello world");
        let parsed = IrcMessage::parse(&line).unwrap();
        assert_eq!(parsed, msg);
    }

    #[test]
    fn parse_tags() {
        let parsed = IrcMessage::parse("@msgid=abc;+draft/reply=1 :bob PRIVMSG #c :hi").unwrap();
        assert_eq!(parsed.tags.get("msgid").map(String::as_str), Some("abc"));
        assert_eq!(parsed.command, "PRIVMSG");
        assert_eq!(parsed.params, vec!["#c", "hi"]);
    }
}
