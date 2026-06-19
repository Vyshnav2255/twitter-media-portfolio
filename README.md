# twitter-media-portfolio

Turn your Twitter/X media posts into a visual portfolio. Clone, connect your profile, and get an instant media grid you can curate and share.

## Quick Start

Requires **Node.js 20+** and a supported Chromium browser logged into x.com (macOS).

```bash
git clone https://github.com/Nomanjack/twitter-media-portfolio.git
cd twitter-media-portfolio
npm install
```

### With Claude Code

Open the project in [Claude Code](https://claude.com/claude-code) and say:

> Set up my portfolio for @yourusername

Claude will configure everything, sync your posts, and start the preview.

### Manual Setup

1. Edit `portfolio.config.json` — set your handle
2. Sync your media:
   ```bash
   node sync-media.js
   ```
3. Start the server:
   ```bash
   node server.js
   ```
4. Open **http://localhost:3000**

## Features

- **2 layouts** — Grid and Feed — finite scrolling with no repeated tiles
- **Edit mode** — Click the pencil to toggle. Click posts to show/hide. Saved to config automatically.
- **Light/Dark theme** — Respects system preference, toggleable
- **Lightbox** — Click any post to view full-size with a link to the original tweet
- **Drag navigation** — Drag or scroll through your media

## Configuration

`portfolio.config.json`:

```json
{
  "handle": "yourusername",
  "maxPosts": 200,
  "browser": "arc",
  "hiddenIds": [],
  "hiddenMediaIds": []
}
```

| Key | Description |
|-----|-------------|
| `handle` | Your Twitter/X username (without @) |
| `maxPosts` | How many posts to fetch (default 200) |
| `browser` | Browser to read cookies from: `arc` or `chrome` |
| `browserProfile` | Optional browser profile folder, for example `Default` or `Profile 1` |
| `hiddenIds` | Legacy tweet IDs hidden from portfolio |
| `hiddenMediaIds` | Individual media item IDs hidden from portfolio (managed via edit mode) |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Query not found" | Twitter's GraphQL query IDs change. Open x.com DevTools → Network → filter `graphql` → update IDs in `sync-media.js` |
| "No ct0 cookie found" | Log into x.com in the configured browser first. If you use multiple profiles, set `browserProfile` |
| Port 3000 in use | `PORT=3001 node server.js` |

## Tech

- Vanilla JS — no framework
- [Motion One](https://motion.dev) for spring animations
- DOM pooling (~500 elements) for smooth virtualized rendering
- Twitter GraphQL API with browser cookie auth

## Credits

Built on top of [@daniel__designs](https://twitter.com/daniel__designs)' twitter-bookmarks-grid.

## License

MIT
