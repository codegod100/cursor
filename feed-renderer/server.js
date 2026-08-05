const express = require("express");
const path = require("path");
const Parser = require("rss-parser");

const app = express();
const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ],
  },
});

const PORT = process.env.PORT || 3456;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidFeedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return escapeHtml(date.toLocaleString());
}

function renderFeedPage(feed, feedUrl) {
  const title = escapeHtml(feed.title || "Untitled Feed");
  const description = feed.description || feed.subtitle || "";
  const link = feed.link || feedUrl;
  const items = feed.items || [];

  const itemsHtml = items
    .map((item) => {
      const itemTitle = escapeHtml(item.title || "Untitled");
      const itemLink = item.link ? escapeHtml(item.link) : "";
      const pubDate = formatDate(item.pubDate || item.isoDate);
      const author = escapeHtml(item.creator || item.author || "");
      const content = item.content || item.contentSnippet || item.summary || "";

      return `
        <article class="feed-item">
          <h2 class="feed-item-title">
            ${itemLink ? `<a href="${itemLink}" target="_blank" rel="noopener noreferrer">${itemTitle}</a>` : itemTitle}
          </h2>
          <div class="feed-item-meta">
            ${pubDate ? `<time>${pubDate}</time>` : ""}
            ${author ? `<span class="author">by ${author}</span>` : ""}
          </div>
          ${content ? `<div class="feed-item-content">${content}</div>` : ""}
        </article>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Feed Renderer</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="page-header">
    <a href="/" class="back-link">← Back</a>
    <h1>${title}</h1>
    ${description ? `<p class="feed-description">${escapeHtml(description)}</p>` : ""}
    <p class="feed-source">
      Source: <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(feedUrl)}</a>
    </p>
    <p class="feed-count">${items.length} item${items.length === 1 ? "" : "s"}</p>
  </header>
  <main class="feed-items">
    ${itemsHtml || '<p class="empty">No items found in this feed.</p>'}
  </main>
</body>
</html>`;
}

function renderErrorPage(message, feedUrl = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — Feed Renderer</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="error-page">
    <a href="/" class="back-link">← Back</a>
    <h1>Could not render feed</h1>
    <p class="error-message">${escapeHtml(message)}</p>
    ${feedUrl ? `<p class="feed-source">URL: <code>${escapeHtml(feedUrl)}</code></p>` : ""}
  </main>
</body>
</html>`;
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

app.get("/render", async (req, res) => {
  const feedUrl = (req.query.url || "").trim();

  if (!feedUrl) {
    return res.status(400).send(renderErrorPage("Please provide a feed URL."));
  }

  if (!isValidFeedUrl(feedUrl)) {
    return res.status(400).send(renderErrorPage("URL must start with http:// or https://", feedUrl));
  }

  try {
    const feed = await parser.parseURL(feedUrl);
    res.send(renderFeedPage(feed, feedUrl));
  } catch (error) {
    const message = error.message || "Failed to fetch or parse the feed.";
    res.status(502).send(renderErrorPage(message, feedUrl));
  }
});

app.post("/render", async (req, res) => {
  const feedUrl = (req.body.url || "").trim();

  if (!feedUrl) {
    return res.status(400).send(renderErrorPage("Please provide a feed URL."));
  }

  if (!isValidFeedUrl(feedUrl)) {
    return res.status(400).send(renderErrorPage("URL must start with http:// or https://", feedUrl));
  }

  try {
    const feed = await parser.parseURL(feedUrl);
    res.send(renderFeedPage(feed, feedUrl));
  } catch (error) {
    const message = error.message || "Failed to fetch or parse the feed.";
    res.status(502).send(renderErrorPage(message, feedUrl));
  }
});

app.listen(PORT, () => {
  console.log(`Feed renderer running at http://localhost:${PORT}`);
});
