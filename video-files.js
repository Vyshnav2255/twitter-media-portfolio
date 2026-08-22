const { execFileSync } = require("child_process");
const {
  copyFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  mkdirSync,
} = require("fs");
const { join } = require("path");

const PROJECT_ROOT = __dirname;

function sanitizeFileName(value) {
  return String(value || "media")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "media";
}

function localVideoRelativePath(tweetId, index) {
  return `assets/videos/${sanitizeFileName(tweetId)}-${index}.mp4`;
}

function localVideoAbsolutePath(tweetId, index) {
  return join(PROJECT_ROOT, localVideoRelativePath(tweetId, index));
}

function parseMediaId(mediaId) {
  const match = String(mediaId).match(/^(.+)-(\d+)$/);
  if (!match) return null;
  return { tweetId: match[1], index: Number(match[2]) };
}

function isMediaHidden(mediaId, hiddenIds, hiddenMediaIds) {
  const parsed = parseMediaId(mediaId);
  if (!parsed) return false;
  return hiddenMediaIds.has(mediaId) || hiddenIds.has(parsed.tweetId);
}

function isVideoImage(image) {
  return image?.type === "video" || (Array.isArray(image?.videoVariants) && image.videoVariants.length > 0);
}

function getBestVideoUrl(image) {
  const variants = Array.isArray(image?.videoVariants) ? image.videoVariants : [];
  const sorted = variants
    .filter((variant) => variant.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return sorted[0]?.url || null;
}

function downloadVideoToLocal(remoteUrl, tweetId, index) {
  if (!remoteUrl) return null;

  const outputPath = localVideoAbsolutePath(tweetId, index);
  const tmpPath = `${outputPath}.tmp`;

  if (existsSync(outputPath)) {
    return localVideoRelativePath(tweetId, index);
  }

  mkdirSync(join(PROJECT_ROOT, "assets", "videos"), { recursive: true });

  try {
    execFileSync("curl", [
      "-L",
      "-A",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "-H",
      "Referer: https://x.com/",
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "90",
      "-o",
      tmpPath,
      remoteUrl,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    copyFileSync(tmpPath, outputPath);
    unlinkSync(tmpPath);
    return localVideoRelativePath(tweetId, index);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch {}
    throw new Error(error.message || "Video download failed");
  }
}

function deleteLocalVideo(tweetId, index) {
  const outputPath = localVideoAbsolutePath(tweetId, index);
  if (existsSync(outputPath)) {
    unlinkSync(outputPath);
  }
}

function getLocalVideoUsageSet(posts) {
  const used = new Set();

  for (const post of posts || []) {
    for (const image of post.images || []) {
      if (typeof image.videoUrl === "string" && image.videoUrl.startsWith("assets/videos/")) {
        used.add(image.videoUrl);
      }
    }
  }

  return used;
}

function cleanupUnusedVideoFiles(posts, config) {
  const videoDir = join(PROJECT_ROOT, "assets", "videos");
  if (!existsSync(videoDir)) return 0;

  const used = getLocalVideoUsageSet(posts);
  const hiddenMediaIds = new Set(config.hiddenMediaIds || []);
  const hiddenPostIds = new Set(config.hiddenIds || []);

  let removed = 0;
  for (const file of readdirSync(videoDir)) {
    if (!file.endsWith(".mp4")) continue;

    const relative = `assets/videos/${file}`;
    const mediaKey = file.replace(/\.mp4$/, "");
    const isReferenced = used.has(relative);
    const isHiddenMedia = hiddenMediaIds.has(mediaKey);
    const isHiddenPost = hiddenPostIds.has(mediaKey.split("-")[0]);

    if (!isHiddenMedia && !isHiddenPost && isReferenced) {
      continue;
    }

    unlinkSync(join(videoDir, file));
    removed++;
  }

  if (removed > 0) {
    console.log(`  Removed ${removed} unused video file(s) from assets/videos`);
  }

  return removed;
}

function syncVideoFilesForHiddenChange(prevConfig, nextConfig, portfolioData) {
  const prevHiddenIds = new Set(prevConfig.hiddenIds || []);
  const prevHiddenMediaIds = new Set(prevConfig.hiddenMediaIds || []);
  const nextHiddenIds = new Set(nextConfig.hiddenIds || []);
  const nextHiddenMediaIds = new Set(nextConfig.hiddenMediaIds || []);

  const videoUpdates = {};
  const rollbackActions = [];
  const errors = [];

  for (const post of portfolioData.posts || []) {
    for (let index = 0; index < (post.images || []).length; index++) {
      const image = post.images[index];
      if (!isVideoImage(image)) continue;

      const mediaId = `${post.id}-${index}`;
      const wasHidden = isMediaHidden(mediaId, prevHiddenIds, prevHiddenMediaIds);
      const nowHidden = isMediaHidden(mediaId, nextHiddenIds, nextHiddenMediaIds);
      const previousVideoUrl = image.videoUrl;

      if (!wasHidden && nowHidden) {
        try {
          deleteLocalVideo(post.id, index);
          rollbackActions.push(() => {
            const remoteUrl = getBestVideoUrl(image);
            if (!remoteUrl) return;
            downloadVideoToLocal(remoteUrl, post.id, index);
            image.videoUrl = previousVideoUrl;
          });
          image.videoUrl = null;
          videoUpdates[mediaId] = null;
        } catch (error) {
          errors.push(`Failed to delete video for ${mediaId}: ${error.message}`);
        }
        continue;
      }

      if (wasHidden && !nowHidden) {
        const remoteUrl = getBestVideoUrl(image);
        if (!remoteUrl) {
          errors.push(`No video source available for ${mediaId}`);
          continue;
        }

        try {
          const localUrl = downloadVideoToLocal(remoteUrl, post.id, index);
          rollbackActions.push(() => {
            deleteLocalVideo(post.id, index);
            image.videoUrl = previousVideoUrl;
          });
          image.videoUrl = localUrl;
          videoUpdates[mediaId] = localUrl;
        } catch (error) {
          errors.push(`Failed to download video for ${mediaId}: ${error.message}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    for (const rollback of rollbackActions.reverse()) {
      try {
        rollback();
      } catch {}
    }
    return { videoUpdates: {}, errors };
  }

  return { videoUpdates, errors };
}

module.exports = {
  downloadVideoToLocal,
  deleteLocalVideo,
  cleanupUnusedVideoFiles,
  syncVideoFilesForHiddenChange,
  isMediaHidden,
  isVideoImage,
  getBestVideoUrl,
  sanitizeFileName,
};
