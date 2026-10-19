// Portfolio data
let ALL_POSTS = [];
let ALL_MEDIA_ITEMS = [];
let VISIBLE_MEDIA_ITEMS = [];
let PROFILE = null;
let CONFIG = null;
let activeLayout = "grid";
let editMode = false;
let hiddenIds = new Set();
let hiddenMediaIds = new Set();

const HIDDEN_STATE_STORAGE_KEY = "portfolio-hidden-state";

const GRID_CONFIG = {
  COLS: 5,
  GAP: 24,
  MIN_ITEM_WIDTH: 150,
  POOL_SIZE: 120,
  BUFFER: 800,
};

const state = {
  cameraOffset: { x: 0, y: 0 },
  targetOffset: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  isDragging: false,
  previousMousePosition: { x: 0, y: 0 },
  dragStartPosition: { x: 0, y: 0 },
  hasDragged: false,
  touchStart: null,
  lightboxOpen: false,
  lightboxItem: null,
  lightboxAnimating: false,
  lightboxNavigationQueue: 0,
  lightboxSwipeStart: null,
};

const viewport = document.getElementById("viewport");
const grid = document.getElementById("grid");
const overlay = document.getElementById("lightbox-overlay");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxLink = document.getElementById("lightbox-link");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const lightboxNavHint = document.getElementById("lightbox-nav-hint");
const backgroundMusic = document.getElementById("background-music");

// Browsers block audible autoplay until the visitor has interacted with the
// page, so a plain play() call is rejected on a cold visit. Rather than leaving
// the track silently paused, retry on the first real gesture so the music simply
// starts once the visitor touches anything.
const MUSIC_UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend", "scroll"];

const unlockMusicOnFirstGesture = () => {
  if (!backgroundMusic) return;

  const attempt = () => {
    if (!backgroundMusic.paused) {
      detach();
      return;
    }
    backgroundMusic.play().then(detach, () => {});
  };
  const detach = () => {
    for (const name of MUSIC_UNLOCK_EVENTS) window.removeEventListener(name, attempt);
  };

  for (const name of MUSIC_UNLOCK_EVENTS) {
    window.addEventListener(name, attempt, { passive: true });
  }
};

if (backgroundMusic) {
  backgroundMusic.volume = 0.12;
  backgroundMusic.muted = false;
  backgroundMusic
    .play()
    .catch(() => unlockMusicOnFirstGesture());
}

const canShowEditControls = () => {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || new URLSearchParams(window.location.search).has("edit");
};

const PROFILE_DETAILS = {
  shortBio: "friendly neighbourhood designer ✦ prev. @brainfishAI ✦ yelling (nicely) about design, code, books & cars",
  websiteUrl: "https://vyshnav.xyz/",
  websiteLabel: "Personal website",
  sourceCodeUrl: "https://github.com/Vyshnav2255/twitter-media-portfolio",
};

let infoPopoverEl = null;

// --- Theme ---

const getSystemTheme = () =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

const applyTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("portfolio-theme", theme);
};

const initTheme = () => {
  const saved = localStorage.getItem("portfolio-theme");
  applyTheme(saved || getSystemTheme());

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!localStorage.getItem("portfolio-theme")) {
      applyTheme(getSystemTheme());
    }
  });
};

const toggleTheme = () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
};

// --- Layout data ---
let layoutItems = [];
let layoutItemByMediaId = new Map();
let visibleMediaIndexById = new Map();
let colWidth = 0;
let totalWidth = 0;
let maxColHeight = 0;

const buildMediaItems = (posts) =>
  posts.flatMap((post) =>
    (post.images || []).map((image, index) => ({
      id: `${post.id}-${index}`,
      post,
      image,
      mediaIndex: index,
    }))
  );

const getDisplayMediaItems = () => {
  if (editMode) return ALL_MEDIA_ITEMS;
  return ALL_MEDIA_ITEMS.filter((item) => !isMediaHidden(item));
};

const getVisibleMediaCount = () =>
  ALL_MEDIA_ITEMS.filter((item) => !isMediaHidden(item)).length;

const isMediaHidden = (mediaItem) =>
  hiddenMediaIds.has(mediaItem.id) || hiddenIds.has(mediaItem.post.id);

const computeToggleMediaHidden = (mediaItem) => {
  const nextHiddenIds = new Set(hiddenIds);
  const nextHiddenMediaIds = new Set(hiddenMediaIds);

  if (nextHiddenIds.has(mediaItem.post.id)) {
    nextHiddenIds.delete(mediaItem.post.id);
    for (const item of ALL_MEDIA_ITEMS) {
      if (item.post.id === mediaItem.post.id && item.id !== mediaItem.id) {
        nextHiddenMediaIds.add(item.id);
      }
    }
  } else if (nextHiddenMediaIds.has(mediaItem.id)) {
    nextHiddenMediaIds.delete(mediaItem.id);
  } else {
    nextHiddenMediaIds.add(mediaItem.id);
  }

  return {
    hiddenIds: [...nextHiddenIds],
    hiddenMediaIds: [...nextHiddenMediaIds],
  };
};

const applyVideoUpdates = (videoUpdates) => {
  if (!videoUpdates) return;

  for (const [mediaId, videoUrl] of Object.entries(videoUpdates)) {
    const mediaItem = ALL_MEDIA_ITEMS.find((item) => item.id === mediaId);
    if (mediaItem) {
      mediaItem.image.videoUrl = videoUrl;
    }
  }
};

const getHiddenState = () => ({
  hiddenIds: [...hiddenIds],
  hiddenMediaIds: [...hiddenMediaIds],
});

const loadLocalHiddenState = () => {
  try {
    const raw = localStorage.getItem(HIDDEN_STATE_STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    for (const id of saved.hiddenIds || []) hiddenIds.add(id);
    for (const id of saved.hiddenMediaIds || []) hiddenMediaIds.add(id);
    return true;
  } catch {
    return false;
  }
};

const saveLocalHiddenState = () => {
  try {
    localStorage.setItem(HIDDEN_STATE_STORAGE_KEY, JSON.stringify(getHiddenState()));
  } catch {}
};

const getResponsiveGridMetrics = (vw) => {
  const gap = GRID_CONFIG.GAP;
  const sidePadding = 24;
  const topPadding = 24;
  let cols = GRID_CONFIG.COLS;

  if (vw <= 1840) cols = Math.min(cols, 4);
  if (vw <= 1440) cols = Math.min(cols, 3);
  if (vw <= 840) cols = 2;
  if (vw <= 620) cols = Math.min(cols, 2);
  if (vw <= 420) cols = 1;

  const availableWidth = Math.max(vw - sidePadding * 2, 0);
  const itemW = Math.max(
    GRID_CONFIG.MIN_ITEM_WIDTH,
    (availableWidth - gap * (cols - 1)) / cols
  );
  const gridWidth = itemW * cols + gap * (cols - 1);

  return {
    cols,
    itemW,
    colWidth: itemW + gap,
    gridWidth,
    availableWidth,
    sidePadding,
    topPadding,
  };
};

const buildLayout = () => {
  VISIBLE_MEDIA_ITEMS = getDisplayMediaItems();
  visibleMediaIndexById = new Map(
    VISIBLE_MEDIA_ITEMS.map((item, index) => [item.id, index])
  );
  if (activeLayout === "feed") buildFeedLayout();
  else if (activeLayout === "grid") buildGridLayout();
  else buildMasonryLayout();
  layoutItemByMediaId = new Map(
    layoutItems.map((item) => [item.mediaItem.id, item])
  );
};

const buildMasonryLayout = () => {
  const vw = window.innerWidth;
  const gap = GRID_CONFIG.GAP;
  const metrics = getResponsiveGridMetrics(vw);

  colWidth = metrics.colWidth;
  totalWidth = metrics.gridWidth;

  const colHeights = new Array(metrics.cols).fill(metrics.topPadding);
  const columns = Array.from({ length: metrics.cols }, () => []);

  for (const mediaItem of VISIBLE_MEDIA_ITEMS) {
    let minCol = 0;
    for (let c = 1; c < metrics.cols; c++) {
      if (colHeights[c] < colHeights[minCol]) minCol = c;
    }

    const img = mediaItem.image;
    const aspect = img.width / img.height;
    const itemW = metrics.itemW;
    const itemH = itemW / aspect;

    const x = minCol * colWidth;
    const y = colHeights[minCol];

    columns[minCol].push({ mediaItem, post: mediaItem.post, image: mediaItem.image, x, y, w: itemW, h: itemH });
    colHeights[minCol] += itemH + gap;
  }

  maxColHeight = Math.ceil(Math.max(...colHeights, 1));

  layoutItems = [];
  for (let col = 0; col < metrics.cols; col++) {
    for (let row = 0; row < columns[col].length; row++) {
      layoutItems.push({ key: `${col}-${row}`, ...columns[col][row] });
    }
  }
};

const buildGridLayout = () => {
  const vw = window.innerWidth;
  const gap = GRID_CONFIG.GAP;
  const metrics = getResponsiveGridMetrics(vw);

  const cols = metrics.cols;
  colWidth = metrics.colWidth;
  totalWidth = metrics.gridWidth;
  const itemW = metrics.itemW;

  layoutItems = [];
  let colHeights = new Array(cols).fill(metrics.topPadding);

  for (let i = 0; i < VISIBLE_MEDIA_ITEMS.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const mediaItem = VISIBLE_MEDIA_ITEMS[i];
    const img = mediaItem.image;
    const aspect = img.width / img.height;
    const itemH = itemW / aspect;

    const y = colHeights[col];

    layoutItems.push({
      key: `${col}-${row}`,
      mediaItem,
      post: mediaItem.post,
      image: mediaItem.image,
      x: col * colWidth,
      y,
      w: itemW,
      h: itemH,
    });

    colHeights[col] += itemH + gap;
  }

  maxColHeight = Math.ceil(Math.max(...colHeights, 1));
};

const buildFeedLayout = () => {
  const vw = window.innerWidth;
  const gap = GRID_CONFIG.GAP;
  const metrics = getResponsiveGridMetrics(vw);
  const feedW = Math.min(560, vw - gap * 2);

  // totalWidth = feedW so centerOffsetX centers the feed column exactly
  colWidth = feedW;
  totalWidth = feedW;

  let y = metrics.topPadding;

  layoutItems = [];
  for (let i = 0; i < VISIBLE_MEDIA_ITEMS.length; i++) {
    const mediaItem = VISIBLE_MEDIA_ITEMS[i];
    const img = mediaItem.image;
    const aspect = img.width / img.height;
    const itemH = feedW / aspect;

    layoutItems.push({
      key: `0-${i}`,
      mediaItem,
      post: mediaItem.post,
      image: mediaItem.image,
      x: 0,
      y,
      w: feedW,
      h: itemH,
    });
    y += itemH + gap;
  }

  maxColHeight = y || 1;
};

// --- DOM Pool ---
const pool = [];
const freePool = [];
const activeMap = new Map();
const elToMediaItem = new WeakMap();
const hoverPreviewWarmers = new Map();
const MAX_HOVER_PREVIEW_WARMERS = 2;

const resolveVideoSource = (url) => {
  if (!url || /^https?:\/\//i.test(url)) return "";
  return `./${url.replace(/^\.\//, "")}`;
};

const setVideoSource = (video, url) => {
  if (!url) {
    video.removeAttribute("src");
    return;
  }

  video.src = resolveVideoSource(url);
};

const createHoverPreviewVideo = (mediaItem) => {
  const video = document.createElement("video");
  setVideoSource(video, mediaItem.image.videoUrl);
  video.poster = twitterImageUrl(mediaItem.image.url, "medium");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  return video;
};

const warmHoverPreview = (mediaItem) => {
  if (
    activeLayout !== "grid" ||
    mediaItem.image.type !== "video" ||
    !mediaItem.image.videoUrl ||
    hoverPreviewWarmers.has(mediaItem.id)
  ) return;

  if (hoverPreviewWarmers.size >= MAX_HOVER_PREVIEW_WARMERS) {
    const [oldestId, oldestVideo] = hoverPreviewWarmers.entries().next().value;
    oldestVideo.remove();
    oldestVideo.removeAttribute("src");
    oldestVideo.load();
    hoverPreviewWarmers.delete(oldestId);
  }

  const video = createHoverPreviewVideo(mediaItem);
  video.className = "hover-preview-warmer";
  video.setAttribute("aria-hidden", "true");
  document.body.appendChild(video);
  hoverPreviewWarmers.set(mediaItem.id, video);
};

const stopHoverPreview = (el) => {
  const preview = el.querySelector(".grid-item-video-preview");
  if (preview) {
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    preview.remove();
  }

  el.classList.remove("is-video-previewing");
  const badge = el.querySelector(".grid-item-video-badge");
  const mediaItem = elToMediaItem.get(el);
  if (badge) badge.style.display = mediaItem?.image.type === "video" ? "" : "none";
};

const startHoverPreview = (el) => {
  const mediaItem = elToMediaItem.get(el);
  if (
    activeLayout !== "grid" ||
    editMode ||
    state.lightboxOpen ||
    mediaItem?.image.type !== "video" ||
    !mediaItem.image.videoUrl ||
    el.querySelector(".grid-item-video-preview")
  ) return;

  const video = hoverPreviewWarmers.get(mediaItem.id) || createHoverPreviewVideo(mediaItem);
  hoverPreviewWarmers.delete(mediaItem.id);
  video.className = "grid-item-video-preview";
  video.setAttribute("aria-label", "Video preview");

  el.appendChild(video);
  video.play().catch(() => {});
  el.classList.add("is-video-previewing");
  const badge = el.querySelector(".grid-item-video-badge");
  if (badge) badge.style.display = "none";
};

const createPool = () => {
  grid.innerHTML = "";
  pool.length = 0;
  freePool.length = 0;
  activeMap.clear();

  // Keep DOM work bounded even when the portfolio contains thousands of media items.
  const poolSize = GRID_CONFIG.POOL_SIZE;
  for (let i = 0; i < poolSize; i++) {
    const el = document.createElement("div");
    el.className = "grid-item";
    el.style.display = "none";
    el.innerHTML = `<img src="" alt="" loading="lazy" decoding="async"><div class="grid-item-video-badge" style="display:none"><svg class="play-pill-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 5 20.5 12 7 19Z" fill="white"/></svg></div><div class="grid-item-hidden-overlay"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>`;
    el.addEventListener("mouseenter", () => startHoverPreview(el));
    el.addEventListener("mouseleave", () => stopHoverPreview(el));
    grid.appendChild(el);
    pool.push(el);
    freePool.push(el);
  }
};

const acquireElement = () => {
  if (freePool.length === 0) return null;
  const el = freePool.pop();
  el.style.display = "";
  return el;
};

const releaseElement = (el) => {
  stopHoverPreview(el);
  el.style.display = "none";
  el.style.visibility = "";
  el.classList.remove("hidden-post");
  // Pool elements are recycled, so intro state must never leak onto the next tile.
  el.classList.remove("is-intro-pending");
  el.style.transitionDelay = "";
  const img = el.querySelector("img");
  if (img) img.classList.remove("is-loaded");
  const badge = el.querySelector(".grid-item-video-badge");
  if (badge) badge.style.display = "none";
  freePool.push(el);
};

// Keeps at most one load listener per pooled image. Pool elements are recycled,
// so re-binding without clearing first would stack listeners across cycles.
const watchImageLoad = (img) => {
  if (img._loadListener) {
    img.removeEventListener("load", img._loadListener);
    img.removeEventListener("error", img._loadListener);
  }

  const onLoad = () => img.classList.add("is-loaded");
  img._loadListener = onLoad;
  // Error still marks it loaded, otherwise a dead URL leaves an invisible tile.
  img.addEventListener("load", onLoad, { once: true });
  img.addEventListener("error", onLoad, { once: true });

  // Cached images can already be decoded by the time we get here.
  if (img.complete && img.naturalWidth > 0) onLoad();
};

// --- Intro animation (first paint only) ---

// Tiles arrive in column-major layout order, so staggering by array position
// makes the wave snake down the leftmost column. Delays are derived from
// on-screen distance instead, which reads as the grid blooming outward from
// wherever the visitor is actually looking.
const INTRO_STEP_MS = 34;
const INTRO_MAX_DELAY_MS = 340;
const INTRO_IMAGE_WAIT_MS = 650;

let hasPlayedIntro = false;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Waiting for the first screenful of images turns what would be a flash of empty
// tiles into an actual reveal. The cap keeps a slow connection from stalling it.
const whenFirstImagesReady = (items) =>
  Promise.race([
    Promise.all(
      items.map(({ el }) => {
        const img = el.querySelector("img");
        if (!img || !img.getAttribute("src")) return Promise.resolve();
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return img.decode().catch(() => {});
      })
    ),
    new Promise((resolve) => setTimeout(resolve, INTRO_IMAGE_WAIT_MS)),
  ]);

// Reveals column by column, top to bottom, then across. Sorting on the tile's
// own x/y keeps this correct regardless of how the layout built its item list.
// A fixed step keeps the cascade even and caps the total so a dense grid cannot
// drag the reveal out.
const getIntroDelays = (items) => {
  const ordered = [...items].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  return new Map(
    ordered.map((item, index) => [item, Math.min(index * INTRO_STEP_MS, INTRO_MAX_DELAY_MS)])
  );
};

const playIntro = (items) => {
  if (prefersReducedMotion()) return;

  const delays = getIntroDelays(items);

  items.forEach((item) => {
    item.el.classList.add("is-intro-pending");
    item.el.style.transitionDelay = `${delays.get(item)}ms`;
  });

  // One forced layout pins the starting state for every tile, so the single
  // reflow below is enough to start all the transitions together.
  void grid.offsetHeight;

  const clear = () =>
    items.forEach((item) => {
      item.el.classList.remove("is-intro-pending");
      // Drop the stagger delay too, so it can't linger on a later opacity change.
      item.el.style.transitionDelay = "";
    });

  requestAnimationFrame(clear);
  // Background tabs suspend rAF entirely, so a timeout backstop guarantees the
  // tiles can never be stranded at opacity 0 if the tab is never focused.
  setTimeout(clear, 250);
};

// --- Twitter image sizing ---
const twitterImageUrl = (url, size = "small") => {
  const base = url.split("?")[0];
  const ext = base.match(/\.(jpg|jpeg|png)$/i);
  const format = ext ? ext[1].toLowerCase() : "jpg";
  return `${base}?format=${format}&name=${size}`;
};

// --- Virtualized Renderer ---

const renderVisibleItems = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scrollTop = window.scrollY;
  const minVisibleY = Math.max(0, scrollTop - GRID_CONFIG.BUFFER);
  const maxVisibleY = scrollTop + vh + GRID_CONFIG.BUFFER;

  const lightboxEl = state.lightboxItem?.element || null;

  let centerOffsetX = 0;
  if (activeLayout === "feed" || activeLayout === "grid") {
    centerOffsetX = Math.floor((vw - totalWidth) / 2);
  }

  const contentWidth = Math.max(totalWidth + 48, vw);
  const contentHeight = Math.max(maxColHeight + 48, vh);
  grid.style.width = `${contentWidth}px`;
  grid.style.height = `${contentHeight}px`;

  const visibleThisFrame = new Set();
  const introItems = [];

  for (let i = 0; i < layoutItems.length; i++) {
    const item = layoutItems[i];

    // Items outside the buffered viewport do not need a DOM node. Layout is
    // still retained in memory for accurate page height and lightbox navigation.
    if (item.y + item.h < minVisibleY || item.y > maxVisibleY) continue;

    const worldX = item.x + centerOffsetX;
    const worldY = item.y;
    const sx = worldX;
    const sy = worldY;

    const visKey = item.key;
    visibleThisFrame.add(visKey);

    const existing = activeMap.get(visKey);
    if (existing) {
      if (existing.poolEl !== lightboxEl) {
        existing.poolEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      }
      if (editMode) {
        existing.poolEl.classList.toggle("hidden-post", isMediaHidden(item.mediaItem));
      } else {
        existing.poolEl.classList.remove("hidden-post");
      }
      existing.screenX = sx;
      existing.screenY = sy;
    } else {
      const el = acquireElement();
      if (!el) continue;

      const img = el.querySelector("img");
      const src = twitterImageUrl(item.image.url, "medium");
      if (img.src !== src) {
        img.src = src;
        img.alt = item.post.text.substring(0, 60);
      }
      // Rebound every time the tile is (re)assigned, including when the cached
      // src matches, because releaseElement clears the loaded class.
      watchImageLoad(img);

      const videoBadge = el.querySelector(".grid-item-video-badge");
      if (videoBadge) {
        videoBadge.style.display = item.image.type === "video" ? "" : "none";
      }

      el.style.width = `${item.w}px`;
      el.style.height = `${item.h}px`;
      el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;

      if (editMode) {
        el.classList.toggle("hidden-post", isMediaHidden(item.mediaItem));
      }

      elToMediaItem.set(el, item.mediaItem);
      const isNearViewport =
        sy + item.h >= scrollTop - 240 &&
        sy <= scrollTop + vh + 240 &&
        sx + item.w >= -240 &&
        sx <= vw + 240;
      if (isNearViewport) warmHoverPreview(item.mediaItem);
      activeMap.set(visKey, {
        poolEl: el,
        layoutItem: item,
        screenX: sx,
        screenY: sy,
      });

      // Only tiles created during the very first render, and only those actually
      // on screen, take part in the intro. Buffered tiles below the fold would
      // otherwise drive the delay spread without the visitor ever seeing it.
      if (!hasPlayedIntro && sy + item.h > scrollTop && sy < scrollTop + vh) {
        introItems.push({ el, cx: sx + item.w / 2, cy: sy + item.h / 2 });
      }
    }
  }

  if (!hasPlayedIntro) {
    hasPlayedIntro = true;
    whenFirstImagesReady(introItems).then(() => playIntro(introItems));
  }

  for (const [visKey, entry] of activeMap) {
    if (!visibleThisFrame.has(visKey) && entry.poolEl !== lightboxEl) {
      releaseElement(entry.poolEl);
      elToMediaItem.delete(entry.poolEl);
      activeMap.delete(visKey);
    }
  }
};

// --- Lightbox ---

const DRAG_THRESHOLD = 5;
let lightboxClone = null;
const lightboxPreloadCache = new Map();

const preloadLightboxMedia = (mediaItem) => {
  if (!mediaItem || lightboxPreloadCache.has(mediaItem.id)) return;

  const { image } = mediaItem;
  const resource = image.type === "video" && image.videoUrl
    ? document.createElement("video")
    : new Image();

  if (resource instanceof HTMLVideoElement) {
    resource.preload = "metadata";
    setVideoSource(resource, image.videoUrl);
    resource.load();
  } else {
    resource.src = twitterImageUrl(image.url, "4096x4096");
  }

  lightboxPreloadCache.set(mediaItem.id, resource);
  if (lightboxPreloadCache.size > 8) {
    const oldestId = lightboxPreloadCache.keys().next().value;
    const oldestResource = lightboxPreloadCache.get(oldestId);
    if (oldestResource instanceof HTMLVideoElement) {
      oldestResource.pause();
      oldestResource.removeAttribute("src");
      oldestResource.load();
    }
    lightboxPreloadCache.delete(oldestId);
  }
};

const preloadLightboxNeighbors = (mediaItem) => {
  const currentIndex = visibleMediaIndexById.get(mediaItem.id);
  if (currentIndex === undefined) return;

  for (const offset of [-2, -1, 1, 2]) {
    const index = (currentIndex + offset + VISIBLE_MEDIA_ITEMS.length) % VISIBLE_MEDIA_ITEMS.length;
    preloadLightboxMedia(VISIBLE_MEDIA_ITEMS[index]);
  }
};

const createLightboxMedia = (image) => {
  if (image.type === "video" && image.videoUrl) {
    const video = document.createElement("video");
    setVideoSource(video, image.videoUrl);
    video.poster = twitterImageUrl(image.url, "medium");
    video.controls = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.setAttribute("loop", "");
    video.preload = "metadata";
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:0;opacity:1;pointer-events:auto;z-index:999;";
    video.addEventListener("loadedmetadata", () => { video.currentTime = 0; });
    video.addEventListener("canplay", () => {
      const promise = video.play();
      if (promise && promise.catch) promise.catch(() => {});
    });
    video.addEventListener("error", (event) => console.error("Video playback error", event));
    return video;
  }

  const hiRes = new Image();
  hiRes.src = twitterImageUrl(image.url, "4096x4096");
  hiRes.alt = "";
  hiRes.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:0;opacity:0;transition:opacity 0.3s ease;";
  hiRes.onload = () => { hiRes.style.opacity = "1"; };
  return hiRes;
};

const getLightboxBounds = (image) => {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const visibleViewport = isMobile ? window.visualViewport : null;
  const vw = visibleViewport?.width ?? window.innerWidth;
  const vh = visibleViewport?.height ?? window.innerHeight;
  const viewportX = visibleViewport?.offsetLeft ?? 0;
  const viewportY = visibleViewport?.offsetTop ?? 0;
  const maxW = isMobile ? vw : vw * 0.7;
  const maxH = isMobile ? vh : vh * 0.7;
  const aspectRatio = image.width / image.height;
  const [width, height] = maxW / maxH > aspectRatio
    ? [maxH * aspectRatio, maxH]
    : [maxW, maxW / aspectRatio];

  return { x: viewportX + (vw - width) / 2, y: viewportY + (vh - height) / 2, width, height };
};

const openLightbox = (el, mediaItem) => {
  if (state.lightboxOpen || state.lightboxAnimating) return;

  stopHoverPreview(el);
  const post = mediaItem?.post;
  const image = mediaItem?.image;

  state.lightboxAnimating = true;
  state.lightboxOpen = true;
  state.lightboxItem = { element: el, mediaItem };

  const rect = el.getBoundingClientRect();
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const visibleViewport = isMobile ? window.visualViewport : null;
  const vw = visibleViewport?.width ?? window.innerWidth;
  const vh = visibleViewport?.height ?? window.innerHeight;
  const viewportX = visibleViewport?.offsetLeft ?? 0;
  const viewportY = visibleViewport?.offsetTop ?? 0;
  const maxW = isMobile ? vw : vw * 0.7;
  const maxH = isMobile ? vh : vh * 0.7;

  const aspectRatio = rect.width / rect.height;
  let targetW, targetH;
  if (maxW / maxH > aspectRatio) {
    targetH = maxH;
    targetW = targetH * aspectRatio;
  } else {
    targetW = maxW;
    targetH = targetW / aspectRatio;
  }

  const startX = rect.left;
  const startY = rect.top;
  const startW = rect.width;
  const startH = rect.height;
  const endX = viewportX + (vw - targetW) / 2;
  const endY = viewportY + (vh - targetH) / 2;

  lightboxClone = document.createElement("div");
  lightboxClone.className = "grid-item lightbox-active";
  lightboxClone.style.width = `${startW}px`;
  lightboxClone.style.height = `${startH}px`;
  lightboxClone.style.display = "";
  lightboxClone.style.visibility = "visible";
  lightboxClone.style.transformOrigin = "center center";
  lightboxClone.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;

  if (image) lightboxClone.appendChild(createLightboxMedia(image));
  document.body.appendChild(lightboxClone);
  preloadLightboxNeighbors(mediaItem);

  overlay.classList.add("active");
  document.body.classList.add("lightbox-open");

  // Set lightbox info
  if (post) {
    // Strip t.co links from caption
    const isVideo = image && image.type === "video";
    let caption = post.text.trim().replace(/https?:\/\/t\.co\/\w+/g, "").trim();
    if (caption) {
      lightboxTitle.textContent = caption.length > 120 ? caption.substring(0, 120) + "\u2026" : caption;
      lightboxTitle.style.display = "";
    } else {
      lightboxTitle.textContent = "";
      lightboxTitle.style.display = "none";
    }
    lightboxLink.href = post.url;
    lightboxLink.textContent = isVideo ? "Watch video on Twitter" : "View on Twitter";
  }

  const lightboxInfo = document.getElementById("lightbox-info");
  lightboxInfo.style.top = `${endY + targetH + 16}px`;
  lightboxNavHint.style.top = `${Math.max(16, endY - 32)}px`;

  const videoElement = lightboxClone.querySelector("video");
  if (videoElement) {
    videoElement.addEventListener("loadedmetadata", () => {
      videoElement.currentTime = 0;
    });
  }

  state.lightboxItem._endX = endX;
  state.lightboxItem._endY = endY;
  state.lightboxItem._endW = targetW;
  state.lightboxItem._endH = targetH;

  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const springDuration = 0.45 + Math.min(distance / 2000, 0.25);

  Motion.animate(
    lightboxClone,
    {
      width: [`${startW}px`, `${targetW}px`],
      height: [`${startH}px`, `${targetH}px`],
      transform: [
        `translate3d(${startX}px, ${startY}px, 0)`,
        `translate3d(${endX}px, ${endY}px, 0)`,
      ],
    },
    { type: "spring", duration: springDuration, bounce: 0.15 }
  ).then(() => {
    state.lightboxAnimating = false;
    flushLightboxNavigationQueue();
  });
};

const closeLightbox = (onClosed) => {
  if (!state.lightboxOpen || state.lightboxAnimating || !state.lightboxItem) return;

  state.lightboxAnimating = true;
  const { element: el } = state.lightboxItem;

  overlay.classList.remove("active");
  document.body.classList.remove("lightbox-open");

  const originalRect = el.getBoundingClientRect();
  const endX = originalRect.left;
  const endY = originalRect.top;
  const endW = originalRect.width;
  const endH = originalRect.height;

  const fromX = state.lightboxItem._endX;
  const fromY = state.lightboxItem._endY;
  const fromW = state.lightboxItem._endW;
  const fromH = state.lightboxItem._endH;

  Motion.animate(
    lightboxClone,
    {
      width: [`${fromW}px`, `${endW}px`],
      height: [`${fromH}px`, `${endH}px`],
      transform: [
        `translate3d(${fromX}px, ${fromY}px, 0)`,
        `translate3d(${endX}px, ${endY}px, 0)`,
      ],
    },
    { type: "spring", duration: 0.4, bounce: 0 }
  ).then(() => {
    lightboxClone.remove();
    lightboxClone = null;
    state.lightboxOpen = false;
    state.lightboxItem = null;
    state.lightboxAnimating = false;
    onClosed?.();
  });
};

const getLightboxElement = (mediaItem) => {
  const layoutItem = layoutItemByMediaId.get(mediaItem.id);
  return layoutItem ? activeMap.get(layoutItem.key)?.poolEl : null;
};

const flushLightboxNavigationQueue = () => {
  if (!state.lightboxOpen || state.lightboxAnimating || !state.lightboxNavigationQueue) return;

  const direction = Math.sign(state.lightboxNavigationQueue);
  state.lightboxNavigationQueue -= direction;
  navigateLightbox(direction);
};

const navigateLightbox = (direction) => {
  if (!state.lightboxOpen || !state.lightboxItem) return;
  if (state.lightboxAnimating) {
    state.lightboxNavigationQueue += direction;
    return;
  }

  const currentIndex = visibleMediaIndexById.get(state.lightboxItem.mediaItem.id);
  if (currentIndex === undefined || VISIBLE_MEDIA_ITEMS.length < 2) return;

  const nextIndex = (currentIndex + direction + VISIBLE_MEDIA_ITEMS.length) % VISIBLE_MEDIA_ITEMS.length;
  const nextMediaItem = VISIBLE_MEDIA_ITEMS[nextIndex];
  let nextElement = getLightboxElement(nextMediaItem);
  if (!nextElement) {
    const nextLayoutItem = layoutItemByMediaId.get(nextMediaItem.id);
    if (!nextLayoutItem) return;
    window.scrollTo(0, Math.max(0, nextLayoutItem.y - window.innerHeight / 2));
    renderVisibleItems();
    nextElement = getLightboxElement(nextMediaItem);
  }

  state.lightboxAnimating = true;

  const nextBounds = getLightboxBounds(nextMediaItem.image);
  const previousMedia = lightboxClone.firstElementChild;
  const nextMedia = createLightboxMedia(nextMediaItem.image);
  nextMedia.style.opacity = "0";
  nextMedia.style.transform = `translate3d(${direction * 100}%, 0, 0)`;
  nextMedia.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)";
  lightboxClone.appendChild(nextMedia);

  if (previousMedia) {
    previousMedia.style.opacity = "0";
    previousMedia.style.transform = `translate3d(${-direction * 100}%, 0, 0)`;
    previousMedia.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)";
    setTimeout(() => {
      if (previousMedia instanceof HTMLVideoElement) previousMedia.pause();
      previousMedia.remove();
    }, 400);
  }

  // Each item is centered at its final dimensions immediately; only the media
  // itself moves, so this reads as a directional carousel rather than a morph.
  lightboxClone.style.width = `${nextBounds.width}px`;
  lightboxClone.style.height = `${nextBounds.height}px`;
  lightboxClone.style.transform = `translate3d(${nextBounds.x}px, ${nextBounds.y}px, 0)`;
  void nextMedia.offsetWidth;
  requestAnimationFrame(() => {
    nextMedia.style.opacity = "1";
    nextMedia.style.transform = "translate3d(0, 0, 0)";
  });

  const post = nextMediaItem.post;
  const caption = post.text.trim().replace(/https?:\/\/t\.co\/\w+/g, "").trim();
  lightboxTitle.textContent = caption.length > 120 ? `${caption.substring(0, 120)}…` : caption;
  lightboxTitle.style.display = caption ? "" : "none";
  lightboxLink.href = post.url;
  lightboxLink.textContent = nextMediaItem.image.type === "video" ? "Watch video on Twitter" : "View on Twitter";
  document.getElementById("lightbox-info").style.top = `${nextBounds.y + nextBounds.height + 16}px`;
  lightboxNavHint.style.top = `${Math.max(16, nextBounds.y - 32)}px`;

  state.lightboxItem = {
    // A tile can be temporarily unmounted by grid virtualization. Keep the
    // current source in that rare case so carousel navigation never drops.
    element: nextElement || state.lightboxItem.element,
    mediaItem: nextMediaItem,
    _endX: nextBounds.x,
    _endY: nextBounds.y,
    _endW: nextBounds.width,
    _endH: nextBounds.height,
  };
  preloadLightboxNeighbors(nextMediaItem);

  let transitionComplete = false;
  let transitionTimeout;
  const onMediaTransitionEnd = (event) => {
    if (event.propertyName === "transform") finishNavigation();
  };
  const finishNavigation = () => {
    if (transitionComplete) return;
    transitionComplete = true;
    nextMedia.removeEventListener("transitionend", onMediaTransitionEnd);
    clearTimeout(transitionTimeout);
    state.lightboxAnimating = false;
    flushLightboxNavigationQueue();
  };
  nextMedia.addEventListener("transitionend", onMediaTransitionEnd);
  transitionTimeout = setTimeout(finishNavigation, 500);
};

const onLightboxTouchStart = (event) => {
  if (!state.lightboxOpen || event.touches.length !== 1) return;

  const touch = event.touches[0];
  state.lightboxSwipeStart = { x: touch.clientX, y: touch.clientY };
};

const onLightboxTouchEnd = (event) => {
  if (!state.lightboxSwipeStart || !event.changedTouches.length) return;

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - state.lightboxSwipeStart.x;
  const deltaY = touch.clientY - state.lightboxSwipeStart.y;
  state.lightboxSwipeStart = null;

  const isHorizontalSwipe = Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
  if (!isHorizontalSwipe) return;

  navigateLightbox(deltaX < 0 ? 1 : -1);
};

// --- Input Handlers ---

const onMouseDown = (e) => {
  if (state.lightboxOpen) return;
  const target = e.target.closest(".grid-item");
  if (!target) return;

  state.isDragging = true;
  state.hasDragged = false;
  state.dragStartPosition = { x: e.clientX, y: e.clientY };
  state.previousMousePosition = { x: e.clientX, y: e.clientY };
};

const onMouseMove = () => {};

const onMouseUp = (e) => {
  if (!state.isDragging) return;
  state.isDragging = false;

  const target = e.target.closest(".grid-item");
  if (!target || state.lightboxOpen) return;

  const mediaItem = elToMediaItem.get(target);
  if (!mediaItem) return;

  if (editMode) {
    const newState = computeToggleMediaHidden(mediaItem);
    saveHiddenIds(newState).then((success) => {
      if (!success) return;
      hiddenIds = new Set(newState.hiddenIds);
      hiddenMediaIds = new Set(newState.hiddenMediaIds);
      saveLocalHiddenState();
      updateEditCounter();
      renderVisibleItems();
    });
  } else {
    openLightbox(target, mediaItem);
  }
};

const onTouchStart = () => {};
const onTouchMove = () => {};
const onTouchEnd = () => {};
const onWheel = () => {};

const onWindowResize = () => {
  buildLayout();
  for (const [visKey, entry] of activeMap) {
    releaseElement(entry.poolEl);
    activeMap.delete(visKey);
  }
  renderVisibleItems();
};

let renderFrame = null;
const scheduleVisibleRender = () => {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderVisibleItems();
  });
};

let resizeFrame = null;
const scheduleLayoutRebuild = () => {
  if (resizeFrame !== null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    onWindowResize();
  });
};

// --- Layout switcher ---

let isTransitioning = false;

const createLayoutSwitcher = () => {
  const switcher = document.createElement("div");
  switcher.id = "layout-switcher";
  switcher.className = "toolbar-group";
  const layouts = [
    { id: "grid", label: "Grid", icon: "assets/grid.svg" },
    { id: "feed", label: "Feed", icon: "assets/feed.svg" },
  ];

  for (const layout of layouts) {
    const btn = document.createElement("button");
    btn.className = "toolbar-btn" + (layout.id === activeLayout ? " active" : "");
    btn.dataset.layout = layout.id;
    btn.title = layout.label;
    btn.innerHTML = `<img src="${layout.icon}" alt="${layout.label}" width="18" height="18">`;
    switcher.appendChild(btn);
  }

  switcher.addEventListener("click", (e) => {
    const btn = e.target.closest(".toolbar-btn");
    if (!btn || btn.dataset.layout === activeLayout) return;
    switcher.querySelector(".toolbar-btn.active").classList.remove("active");
    btn.classList.add("active");
    applyLayout(btn.dataset.layout);
  });

  return switcher;
};

// Rebuilding the layout swaps every pooled element at once, which reads as a hard
// cut. Fading the grid out around the swap hides it, and the slight scale drop
// gives the transition some depth instead of a flat dissolve.
const withGridCrossfade = (mutate, { outMs = 130, inMs = 240 } = {}) => {
  if (prefersReducedMotion()) {
    mutate();
    return;
  }

  isTransitioning = true;
  grid.style.transition = `opacity ${outMs}ms var(--ease-standard), scale ${outMs}ms var(--ease-standard)`;
  grid.style.opacity = "0";
  grid.style.scale = "0.985";

  setTimeout(() => {
    mutate();

    // Commit the rebuilt layout before the fade-in so it transitions in.
    void grid.offsetHeight;

    grid.style.transition = `opacity ${inMs}ms var(--ease-out-soft), scale ${inMs}ms var(--ease-out-soft)`;
    grid.style.opacity = "1";
    grid.style.scale = "1";

    setTimeout(() => {
      grid.style.transition = "";
      grid.style.scale = "";
      isTransitioning = false;
    }, inMs);
  }, outMs);
};

const applyLayout = (layout) => {
  if (isTransitioning) return;
  activeLayout = layout;

  withGridCrossfade(() => {
    document.body.classList.remove("layout-masonry", "layout-grid", "layout-feed");
    document.body.classList.add(`layout-${layout}`);

    for (const [visKey, entry] of activeMap) {
      releaseElement(entry.poolEl);
      activeMap.delete(visKey);
    }

    buildLayout();
    renderVisibleItems();
  });
};

// --- Edit mode ---

const saveHiddenIds = async (state) => {
  try {
    const response = await fetch("/api/hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!response.ok) {
      throw new Error(`Failed to save hidden state: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

const updateEditCounter = () => {
  const counter = document.getElementById("edit-counter");
  if (counter) {
    const total = ALL_MEDIA_ITEMS.length;
    const visible = getVisibleMediaCount();
    counter.textContent = `${visible}/${total}`;
  }
};

const createEditToggle = () => {
  const wrapper = document.createElement("div");
  wrapper.id = "edit-toggle-wrapper";
  wrapper.className = "toolbar-group";

  const btn = document.createElement("button");
  btn.id = "edit-toggle";
  btn.className = "toolbar-btn";
  btn.title = "Edit mode";
  btn.innerHTML = `<img src="assets/edit.svg" alt="Edit" width="18" height="18">`;

  const counter = document.createElement("span");
  counter.id = "edit-counter";
  counter.className = "edit-counter";

  wrapper.appendChild(btn);
  wrapper.appendChild(counter);

  btn.addEventListener("click", () => {
    if (isTransitioning) return;
    editMode = !editMode;
    btn.classList.toggle("active", editMode);
    counter.classList.toggle("visible", editMode);
    document.body.classList.toggle("edit-mode", editMode);

    // Trigger grow animation by removing and re-adding class
    btn.style.animation = "none";
    void btn.offsetHeight;
    btn.style.animation = "";

    if (editMode) {
      updateEditCounter();
    }

    // Rebuild to show/hide hidden posts, faded so the pool swap isn't a hard cut.
    withGridCrossfade(() => {
      for (const [visKey, entry] of activeMap) {
        releaseElement(entry.poolEl);
        activeMap.delete(visKey);
      }
      buildLayout();
      renderVisibleItems();
    });
  });

  return wrapper;
};

// --- Theme toggle ---

// Audio must be started by a visitor interaction; this also keeps the portfolio
// quiet by default for anyone who prefers to browse without background sound.
const createMusicToggle = () => {
  const btn = document.createElement("button");
  btn.id = "music-toggle";
  btn.className = "toolbar-btn";
  btn.type = "button";
  btn.title = "Play lo-fi music";
  btn.setAttribute("aria-label", "Play lo-fi music");
  btn.setAttribute("aria-pressed", "false");

  const icon = document.createElement("img");
  icon.className = "music-toggle-icon";
  icon.width = 18;
  icon.height = 18;
  icon.alt = "Music";
  btn.appendChild(icon);

  const sync = () => {
    const isPlaying = Boolean(backgroundMusic && !backgroundMusic.paused);
    btn.classList.toggle("active", isPlaying);
    icon.src = isPlaying ? "assets/music-on.svg" : "assets/music-off.svg";
    btn.title = isPlaying ? "Pause lo-fi music" : "Play lo-fi music";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(isPlaying));
  };

  sync();

  btn.addEventListener("click", async () => {
    if (!backgroundMusic) return;
    if (backgroundMusic.paused) {
      try {
        await backgroundMusic.play();
      } catch {
        // Playback can fail when the browser has disabled audio output.
      }
    } else {
      backgroundMusic.pause();
    }
    sync();
  });

  backgroundMusic?.addEventListener("play", sync);
  backgroundMusic?.addEventListener("pause", sync);
  return btn;
};

const createThemeToggle = () => {
  const btn = document.createElement("button");
  btn.className = "toolbar-btn";
  btn.title = "Toggle theme";
  btn.innerHTML = `<img src="assets/theme.svg" alt="Theme" width="18" height="18">`;
  btn.addEventListener("click", toggleTheme);
  return btn;
};

const createInfoToggle = () => {
  const btn = document.createElement("button");
  btn.id = "info-toggle";
  btn.className = "toolbar-btn";
  btn.title = "Info";
  btn.innerHTML = `<img src="assets/arrow-down.svg" alt="Info" width="18" height="18">`;
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleInfoPopover(btn);
  });
  return btn;
};

const POPOVER_GAP = 12;
const POPOVER_MARGIN = 12;
const POPOVER_CENTER_MAX_WIDTH = 620;
// Keeps the arrow clear of the card's 26px corner radius.
const POPOVER_ARROW_INSET = 26;

// All popover icons load via <img>, so they cannot inherit CSS `color` the way an
// inline SVG could. These files render black and get flipped with a filter on
// dark chrome instead (see the [data-theme="dark"] rule in style.css).
const POPOVER_ASSETS = {
  x: "assets/x.svg",
  arrowUpRight: "assets/arrow-up-right.svg",
  globe: "assets/globe.svg",
  code: "assets/code.svg",
};

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );

const getHostLabel = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const formatCount = (count) => count.toLocaleString();

const positionInfoPopover = (buttonEl) => {
  if (!infoPopoverEl || !buttonEl) return;
  const anchor = buttonEl.getBoundingClientRect();
  // offsetWidth/Height are layout sizes, so they ignore the opening scale(0.96)
  // that getBoundingClientRect would fold in while the card is still animating.
  const popoverWidth = infoPopoverEl.offsetWidth;
  const popoverHeight = infoPopoverEl.offsetHeight;

  const anchorCenter = anchor.left + anchor.width / 2;

  // Narrow viewports centre the card instead of anchoring it, since the trigger
  // sits off to one side of a nearly full-width toolbar.
  const centerOnViewport = window.innerWidth <= POPOVER_CENTER_MAX_WIDTH;

  // Keep the card on screen by sliding it instead of letting it hang off the edge.
  const halfWidth = popoverWidth / 2;
  const left = centerOnViewport
    ? window.innerWidth / 2
    : Math.min(
        Math.max(anchorCenter, POPOVER_MARGIN + halfWidth),
        window.innerWidth - POPOVER_MARGIN - halfWidth
      );

  let top = anchor.bottom + POPOVER_GAP;
  let placement = "below";
  if (top + popoverHeight > window.innerHeight - POPOVER_MARGIN) {
    top = anchor.top - popoverHeight - POPOVER_GAP;
    placement = "above";
  }
  top = Math.max(
    POPOVER_MARGIN,
    Math.min(top, window.innerHeight - popoverHeight - POPOVER_MARGIN)
  );

  // `left` is the card's centre; the CSS centres it with translateX(-50%).
  // The arrow is positioned from the card's left edge, so rebase before
  // measuring or it lands on the left edge whenever the two coincide.
  const cardLeft = left - halfWidth;
  const inset = Math.min(halfWidth, POPOVER_ARROW_INSET);
  const arrowOffset = Math.min(
    Math.max(anchorCenter - cardLeft, inset),
    popoverWidth - inset
  );

  infoPopoverEl.dataset.placement = placement;
  infoPopoverEl.style.left = `${Math.round(left)}px`;
  infoPopoverEl.style.top = `${Math.round(top)}px`;
  infoPopoverEl.style.setProperty("--popover-arrow-offset", `${Math.round(arrowOffset)}px`);
};

const createInfoPopover = () => {
  const popover = document.createElement("div");
  popover.id = "info-popover";
  popover.className = "info-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Profile info");
  popover.addEventListener("click", (event) => event.stopPropagation());
  document.body.appendChild(popover);
  infoPopoverEl = popover;
  renderInfoPopover();
};

const renderInfoLink = ({ url, label, icon }) => {
  const host = getHostLabel(url);
  return `
    <a class="info-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      <span class="info-link-icon"><img src="${escapeHtml(icon)}" alt="" width="16" height="16"></span>
      <span class="info-link-body">
        <span class="info-link-label">${escapeHtml(label)}</span>
        ${host ? `<span class="info-link-host">${escapeHtml(host)}</span>` : ""}
      </span>
      <span class="info-link-arrow"><img src="${POPOVER_ASSETS.arrowUpRight}" alt="" width="15" height="15"></span>
    </a>
  `;
};

const renderInfoPopover = () => {
  if (!infoPopoverEl) return;

  const handle = CONFIG?.handle || PROFILE?.handle || PROFILE?.name || "";
  const displayName = PROFILE?.name || handle;
  const avatar = PROFILE?.avatar || "";
  const bio = PROFILE_DETAILS.shortBio || PROFILE?.bio || "";
  const twitterUrl = PROFILE?.url || (handle ? `https://x.com/${handle}` : "");
  const sourceCodeUrl = PROFILE_DETAILS.sourceCodeUrl || "";

  // PROFILE.url points at X, so only fall back to it when it is a real external site.
  const profileHost = getHostLabel(PROFILE?.url || "");
  const isExternalProfileUrl = profileHost && !/(^|\.)(x|twitter)\.com$/i.test(profileHost);
  const websiteUrl = PROFILE_DETAILS.websiteUrl || (isExternalProfileUrl ? PROFILE.url : "");

  // Reflects what a visitor actually sees, so hidden posts and media are excluded.
  // This ignores editMode on purpose: those items are dimmed but still unpublished.
  const visibleItems = ALL_MEDIA_ITEMS.filter((item) => !isMediaHidden(item));
  // Videos are the only type the app renders as <video>; photos and animated
  // gifs both fall back to a plain <img>.
  const videoCount = visibleItems.filter((item) => item.image.type === "video").length;
  const imageCount = visibleItems.length - videoCount;

  const stats = [
    imageCount ? { value: imageCount, label: imageCount === 1 ? "image" : "images" } : null,
    videoCount ? { value: videoCount, label: videoCount === 1 ? "video" : "videos" } : null,
  ].filter(Boolean);

  const links = [
    websiteUrl
      ? {
          url: websiteUrl,
          label: PROFILE_DETAILS.websiteLabel || "Personal website",
          icon: POPOVER_ASSETS.globe,
        }
      : null,
    sourceCodeUrl
      ? { url: sourceCodeUrl, label: "Source code", icon: POPOVER_ASSETS.code }
      : null,
  ].filter(Boolean);

  infoPopoverEl.innerHTML = `
    <div class="info-popover-header">
      <div class="info-left">
        <span class="info-avatar-ring">
          <img class="info-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(displayName)} avatar">
        </span>
        <div class="info-header-body">
          <h2 class="info-name">${escapeHtml(displayName)}</h2>
          <a class="info-handle" href="${escapeHtml(twitterUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(handle)}</a>
        </div>
      </div>
      <a class="info-twitter-link" href="${escapeHtml(twitterUrl)}" target="_blank" rel="noopener noreferrer" aria-label="View on X"><img src="${POPOVER_ASSETS.x}" alt="" width="18" height="18"></a>
    </div>
    ${bio ? `<p class="info-bio">${escapeHtml(bio)}</p><div class="info-divider"></div>` : ""}
    ${
      stats.length
        ? `<div class="info-stats">${stats
            .map(
              (stat) =>
                `<div class="info-stat"><span class="info-stat-value">${formatCount(stat.value, "", "")}</span><span class="info-stat-label">${stat.label}</span></div>`
            )
            .join("")}</div>`
        : ""
    }
    ${
      links.length
        ? `<div class="info-actions">${links.map(renderInfoLink).join("")}</div>`
        : ""
    }
  `;
};

const positionInfoPopoverHandler = (buttonEl) => () => positionInfoPopover(buttonEl);

let infoPopoverTrigger = null;

const setInfoPopoverState = (isVisible) => {
  infoPopoverTrigger?.setAttribute("aria-expanded", String(isVisible));
};

const closeInfoPopover = ({ restoreFocus = false } = {}) => {
  if (!infoPopoverEl) return;
  infoPopoverEl.classList.remove("visible");
  setInfoPopoverState(false);
  document.removeEventListener("click", onDocumentClickCloseInfo);
  window.removeEventListener("keydown", onDocumentKeyDownCloseInfo);
  window.removeEventListener("resize", infoPopoverResizeHandler);
  infoPopoverResizeHandler = null;
  if (restoreFocus) infoPopoverTrigger?.focus();
};

let infoPopoverResizeHandler = null;

const toggleInfoPopover = (buttonEl) => {
  if (!infoPopoverEl) createInfoPopover();
  infoPopoverTrigger = buttonEl;

  if (infoPopoverEl.classList.contains("visible")) {
    closeInfoPopover();
    return;
  }

  // Paint the content while hidden, then flip to visible so the staggered reveal plays.
  renderInfoPopover();
  infoPopoverEl.getBoundingClientRect();
  infoPopoverEl.classList.add("visible");
  setInfoPopoverState(true);

  positionInfoPopover(buttonEl);
  document.addEventListener("click", onDocumentClickCloseInfo);
  window.addEventListener("keydown", onDocumentKeyDownCloseInfo);
  infoPopoverResizeHandler = positionInfoPopoverHandler(buttonEl);
  window.addEventListener("resize", infoPopoverResizeHandler);
};

const onDocumentClickCloseInfo = (event) => {
  if (!infoPopoverEl?.contains(event.target) && event.target.id !== "info-toggle") {
    closeInfoPopover();
  }
};

const onDocumentKeyDownCloseInfo = (event) => {
  if (event.key === "Escape") {
    closeInfoPopover({ restoreFocus: true });
  }
};

// --- Profile header ---

const createProfileHeader = () => {
  if (!PROFILE) return;

  const header = document.createElement("button");
  header.id = "profile-header";
  header.className = "profile-header";
  header.type = "button";
  header.title = "Profile info";
  header.setAttribute("aria-haspopup", "dialog");
  header.setAttribute("aria-expanded", "false");
  header.setAttribute("aria-controls", "info-popover");

  const handle = CONFIG?.handle || PROFILE.handle || PROFILE.name;
  const avatar = PROFILE?.avatar || "";

  header.innerHTML = `
    <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(handle)} avatar">
    <span class="profile-handle">@${escapeHtml(handle)}</span>
    <span class="profile-info-icon" aria-hidden="true">
      <img src="assets/arrow-down.svg" alt="" width="16" height="16">
    </span>
  `;

  header.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleInfoPopover(header);
  });

  return header;
};

// --- Top navigation ---

const createToolbar = () => {
  const toolbar = document.createElement("div");
  toolbar.id = "toolbar";
  toolbar.className = "toolbar";

  const layoutSwitcher = createLayoutSwitcher();
  toolbar.appendChild(layoutSwitcher);

  // Localhost can persist to portfolio.config.json. Static deployments can use ?edit=1 for browser-local edits.
  if (canShowEditControls()) {
    const editToggle = createEditToggle();
    toolbar.appendChild(editToggle);
  }

  const rightGroup = document.createElement("div");
  rightGroup.className = "toolbar-group";
  rightGroup.appendChild(createMusicToggle());
  rightGroup.appendChild(createThemeToggle());
  toolbar.appendChild(rightGroup);

  return toolbar;
};

const createTopNav = () => {
  const nav = document.createElement("nav");
  nav.id = "top-nav";
  nav.className = "top-nav";
  nav.setAttribute("aria-label", "Portfolio controls");

  const profileHeader = createProfileHeader();
  if (profileHeader) {
    nav.appendChild(profileHeader);
    const divider = document.createElement("span");
    divider.className = "nav-divider";
    divider.setAttribute("aria-hidden", "true");
    nav.appendChild(divider);
  }

  nav.appendChild(createToolbar());
  document.body.appendChild(nav);
};

// --- Init ---

const init = async () => {
  initTheme();

  // Load portfolio data
  try {
    const res = await fetch("./portfolio-data.json");
    if (!res.ok) throw new Error("Not found");
    const data = await res.json();
    ALL_POSTS = data.posts || [];
    ALL_MEDIA_ITEMS = buildMediaItems(ALL_POSTS);
    PROFILE = data.profile || null;
  } catch {
    console.error("No portfolio-data.json found. Run: node sync-media.js");
    ALL_POSTS = [];
    ALL_MEDIA_ITEMS = [];
  }

  // Load config for hidden IDs
  try {
    const res = await fetch("./portfolio.config.json");
    if (res.ok) {
      CONFIG = await res.json();
      hiddenIds = new Set(CONFIG.hiddenIds || []);
      hiddenMediaIds = new Set(CONFIG.hiddenMediaIds || []);
    }
  } catch {}
  loadLocalHiddenState();

  VISIBLE_MEDIA_ITEMS = getDisplayMediaItems();
  console.log(`Loaded ${VISIBLE_MEDIA_ITEMS.length} media items from ${ALL_POSTS.length} posts`);

  if (PROFILE) {
    document.title = `@${CONFIG?.handle || PROFILE.name} — Portfolio`;
  }

  document.body.classList.add(`layout-${activeLayout}`);
  buildLayout();
  createPool();
  renderVisibleItems();
  createTopNav();

  // Pre-warm Motion
  const warmup = document.createElement("div");
  warmup.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
  document.body.appendChild(warmup);
  Motion.animate(warmup, { opacity: [0, 1] }, { duration: 0.01 }).then(() => warmup.remove());

  viewport.addEventListener("mousedown", onMouseDown);
  viewport.addEventListener("mousemove", onMouseMove);
  viewport.addEventListener("mouseup", onMouseUp);
  viewport.addEventListener("mouseleave", onMouseUp);
  viewport.addEventListener("wheel", onWheel, { passive: true });
  viewport.addEventListener("touchstart", onTouchStart, { passive: true });
  viewport.addEventListener("touchmove", onTouchMove, { passive: true });
  viewport.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("scroll", scheduleVisibleRender, { passive: true });
  window.addEventListener("resize", scheduleLayoutRebuild);
  window.addEventListener("touchstart", onLightboxTouchStart, { passive: true });
  window.addEventListener("touchend", onLightboxTouchEnd, { passive: true });

  lightboxClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeLightbox();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLightbox();
  });
  window.addEventListener("keydown", (e) => {
    if (!state.lightboxOpen) return;

    if (e.key === "Escape") {
      closeLightbox();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      navigateLightbox(e.key === "ArrowLeft" ? -1 : 1);
    }
  });

  // Desktop-only prev/next. These route through navigateLightbox exactly like the
  // arrow keys, so rapid clicks land in the same animation queue rather than
  // fighting it. Swipe and keyboard stay the only affordance on touch devices.
  lightboxPrev?.addEventListener("click", () => navigateLightbox(-1));
  lightboxNext?.addEventListener("click", () => navigateLightbox(1));

};

init();
