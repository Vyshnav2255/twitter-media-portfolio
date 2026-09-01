# twitter-media-portfolio

Turn your Twitter/X media posts into a visual portfolio. Clone, connect your profile, and get an instant media grid you can curate and share.

## Quick Start

Requires **Node.js 20+** and a supported Chromium browser logged into x.com (macOS).

```bash
git clone https://github.com/Vyshnav2255/twitter-media-portfolio.git
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

## Deploy to Vercel

This project deploys as a static site. `server.js` is only for local preview and edit mode.

1. Sync your latest data locally:
   ```bash
   npm run sync
   ```
2. Commit `portfolio-data.json`, `portfolio.config.json`, and your code changes.
3. Import the repo in Vercel.
4. Use these Vercel settings:
   - Framework Preset: **Other**
   - Build Command: `npm run build`
   - Output Directory: `dist`

The deployed site is read-only. Use local edit mode to hide/show media, then commit the updated `portfolio.config.json` and redeploy. On a deployed site, open `?edit=1` to show edit controls; those changes are saved only in that browser.

## Features

- **2 layouts** — Grid and Feed — finite scrolling with no repeated tiles
- **Edit mode** — Click the pencil to toggle. Click posts to show/hide. Saved to config automatically.
- **Light/Dark theme** — Respects system preference, toggleable
- **Optional lo-fi music** — Starts only when the music button is pressed
- **Lightbox** — Click any post to view full-size with a link to the original tweet
- **Drag navigation** — Drag or scroll through your media

## How Media Sync Works

After setting `handle` and `maxPosts` in `portfolio.config.json`, run `npm run sync` or `node sync-media.js` to update your portfolio.

1. The sync uses your saved X login from the browser you chose in the config. Make sure you are logged in to `x.com` first.
2. It gets your posts with images or videos, removes duplicates, puts the newest posts first, and keeps up to the number set in `maxPosts`.
3. It saves the results, including your profile information, in `portfolio-data.json`.
4. It keeps your hide settings in `portfolio.config.json`. If the sync fails or finds nothing, your current portfolio and downloaded videos are left alone.
5. It removes old video files that are no longer needed.

Syncing does not delete anything from your X account. It only updates the copy used by this portfolio.

## Hide, Unhide, and Delete

### Hide

Start the local server and click the pencil button to enter edit mode. Click a media tile to hide it. It will disappear from the normal grid or feed, but you can still see it while editing. Your change is saved automatically in `portfolio.config.json`.

The setting `hiddenMediaIds` keeps track of individual images or videos. The older `hiddenIds` setting hides everything from a whole post and is still supported.

### Unhide

With edit mode enabled, click a hidden tile again. It will show up in the normal view after the change is saved. If it is a video, the portfolio downloads a new local copy first.

### Delete

There is no button that deletes a post from X. When you hide a video, the portfolio deletes only its downloaded `.mp4` file from `assets/videos/` to save space. The post itself is still remembered, so the video can be downloaded again when you unhide it. If the file cannot be removed or downloaded again, the hide or unhide change is cancelled.

## How Videos Work

- When syncing, the portfolio finds the best available MP4 version of each video.
- Videos that are not hidden are downloaded into `assets/videos/`, so they can play from your own portfolio.
- Hidden videos are not downloaded. This saves disk space and makes syncing faster.
- In Grid view, a video can play silently when you hover over it. Open a video to play it with controls.
- The local server and the Vercel build include the downloaded video files. A deployed Vercel site cannot save new hide or unhide changes permanently; make those changes locally and redeploy.

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

Built on top of [@daniel__designs](https://twitter.com/daniel__designs)' twitter-bookmarks-grid & [Nomanjack](https://x.com/Nomandsign)'s twitter-media-portfolio.

Background music: ["Lofi Hip Hop Upbeat"](https://commons.wikimedia.org/wiki/File:Raspberrymusic_-_Lofi_Hip_Hop_Upbeat.ogg) by [Raspberrymusic](https://raspberrysounds.bandcamp.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
## License

MIT
