//// Unified Atom feed generation from followed Bluesky handles.

import friends/bluesky.{type Post, type ReferencedPost}
import friends/config.{type Config}
import friends/html
import friends/store.{type Store, all_handles}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string

/// Public Atom document for every curated handle on this instance.
pub fn build_public_atom(config: Config, store: Store) -> String {
  let followed_handles = all_handles(store)
  let posts =
    followed_handles
    |> list.flat_map(fn(handle) {
      case bluesky.fetch_author_posts(handle, 25) {
        Ok(items) -> items
        Error(_) -> []
      }
    })
    |> sort_posts_newest_first

  render_atom(config, posts)
}

fn sort_posts_newest_first(posts: List(Post)) -> List(Post) {
  list.sort(posts, fn(a, b) {
    string.compare(b.created_at, a.created_at)
  })
}

fn render_atom(config: Config, posts: List(Post)) -> String {
  let feed_url = config.base_url <> "/feed.atom"
  let updated = case posts {
    [] -> timestamp_now()
    [first, ..] -> first.created_at
  }

  let entries =
    posts
    |> list.map(render_entry)
    |> string.join("")

  "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
  <> "<feed xmlns=\"http://www.w3.org/2005/Atom\">"
  <> "<title>"
  <> html.escape_text("Friends")
  <> "</title>"
  <> "<subtitle>"
  <> html.escape_text("Unified public Bluesky feed")
  <> "</subtitle>"
  <> "<link href=\""
  <> html.escape_attr(feed_url)
  <> "\" rel=\"self\"/>"
  <> "<id>"
  <> html.escape_text(feed_url)
  <> "</id>"
  <> "<updated>"
  <> html.escape_text(updated)
  <> "</updated>"
  <> "<author><name>"
  <> html.escape_text("Friends")
  <> "</name></author>"
  <> entries
  <> "</feed>"
}

fn render_entry(post: Post) -> String {
  let title = entry_title(post)
  let author = case post.author_name {
    Some(name) -> name <> " (@" <> post.author_handle <> ")"
    None -> "@" <> post.author_handle
  }

  "<entry>"
  <> "<title>"
  <> html.escape_text(title)
  <> "</title>"
  <> "<link href=\""
  <> html.escape_attr(post.web_url)
  <> "\" rel=\"alternate\"/>"
  <> "<id>"
  <> html.escape_text(post.uri)
  <> "</id>"
  <> "<updated>"
  <> html.escape_text(post.created_at)
  <> "</updated>"
  <> "<published>"
  <> html.escape_text(post.created_at)
  <> "</published>"
  <> "<author><name>"
  <> html.escape_text(author)
  <> "</name></author>"
  <> "<content type=\"html\">"
  <> entry_content_html(post)
  <> "</content>"
  <> "</entry>"
}

/// HTML body for an Atom entry. Replies and quotes include the original post.
pub fn entry_content_html(post: Post) -> String {
  let context =
    case post.reply_to {
      Some(original) -> context_blockquote("In reply to ", original)
      None -> ""
    }
    <> case post.quote_of {
      Some(original) -> context_blockquote("Quoting ", original)
      None -> ""
    }

  context <> "<p>" <> html.escape_text(post.text) <> "</p>"
}

fn context_blockquote(prefix: String, original: ReferencedPost) -> String {
  let label = case original.author_name {
    Some(name) -> name <> " (@" <> original.author_handle <> ")"
    None -> "@" <> original.author_handle
  }

  "<blockquote><p><strong>"
  <> html.escape_text(prefix <> label)
  <> "</strong></p><p>"
  <> html.escape_text(original.text)
  <> "</p></blockquote>"
}

fn entry_title(post: Post) -> String {
  let trimmed = string.trim(post.text)
  let base = case string.length(trimmed) > 80 {
    True -> string.slice(trimmed, 0, 77) <> "..."
    False -> trimmed
  }

  case post.reply_to, post.quote_of, base {
    Some(_), _, "" -> "Reply"
    Some(_), _, text -> "Re: " <> text
    None, Some(_), "" -> "Quote"
    None, Some(_), text -> "QT: " <> text
    None, None, text -> text
  }
}

fn timestamp_now() -> String {
  "1970-01-01T00:00:00.000Z"
}
