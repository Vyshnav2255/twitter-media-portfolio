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
  easingFactor: 0.1,
  POOL_SIZE: 500,
  BUFFER: 600,
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
};

const viewport = document.getElementById("viewport");
const grid = document.getElementById("grid");
const overlay = document.getElementById("lightbox-overlay");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxLink = document.getElementById("lightbox-link");

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

const toggleMediaHidden = (mediaItem) => {
  if (hiddenIds.has(mediaItem.post.id)) {
    hiddenIds.delete(mediaItem.post.id);
    for (const item of ALL_MEDIA_ITEMS) {
      if (item.post.id === mediaItem.post.id && item.id !== mediaItem.id) {
        hiddenMediaIds.add(item.id);
      }
    }
    return;
  }

  if (hiddenMediaIds.has(mediaItem.id)) {
    hiddenMediaIds.delete(mediaItem.id);
  } else {
    hiddenMediaIds.add(mediaItem.id);
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

const getScrollBounds = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lockX = activeLayout === "feed" || activeLayout === "grid";

  return {
    minX: 0,
    maxX: lockX ? 0 : Math.max(totalWidth - vw, 0),
    minY: 0,
    maxY: Math.max(maxColHeight - vh + GRID_CONFIG.GAP, 0),
  };
};

const clampOffset = (offset) => {
  const bounds = getScrollBounds();
  offset.x = Math.min(Math.max(offset.x, bounds.minX), bounds.maxX);
  offset.y = Math.min(Math.max(offset.y, bounds.minY), bounds.maxY);
};

const clampTargetOffset = () => {
  clampOffset(state.targetOffset);
};

const clampAllOffsets = () => {
  clampOffset(state.targetOffset);
  clampOffset(state.cameraOffset);
};

const getResponsiveGridMetrics = (vw) => {
  const gap = GRID_CONFIG.GAP;
  const sidePadding = 24;
  const topPadding = 24;
  let cols = GRID_CONFIG.COLS;

  if (vw <= 1440) cols = Math.min(cols, 4);
  if (vw <= 1040) cols = Math.min(cols, 3);
  if (vw <= 820) cols = 3;
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
  if (activeLayout === "feed") buildFeedLayout();
  else if (activeLayout === "grid") buildGridLayout();
  else buildMasonryLayout();
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

const createPool = () => {
  grid.innerHTML = "";
  pool.length = 0;
  freePool.length = 0;
  activeMap.clear();

  for (let i = 0; i < GRID_CONFIG.POOL_SIZE; i++) {
    const el = document.createElement("div");
    el.className = "grid-item";
    el.style.display = "none";
    el.innerHTML = `<img src="" alt="" loading="lazy" decoding="async"><div class="grid-item-video-badge" style="display:none"><svg class="play-pill-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.25 12C21.25 17.1086 17.1086 21.25 12 21.25C6.89137 21.25 2.75 17.1086 2.75 12C2.75 6.89137 6.89137 2.75 12 2.75C17.1086 2.75 21.25 6.89137 21.25 12Z" fill="#1E1E1E"/><path d="M10 14.804V9.19617C10 8.79446 10.4498 8.55675 10.7817 8.78305L14.8941 11.587C15.1852 11.7855 15.1852 12.2147 14.8941 12.4132L10.7817 15.2171C10.4498 15.4434 10 15.2057 10 14.804Z" fill="white"/></svg></div><div class="grid-item-hidden-overlay"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>`;
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
  el.style.display = "none";
  el.style.visibility = "";
  el.classList.remove("hidden-post");
  const badge = el.querySelector(".grid-item-video-badge");
  if (badge) badge.style.display = "none";
  freePool.push(el);
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
  const buf = GRID_CONFIG.BUFFER;

  const lightboxEl = state.lightboxItem?.element || null;
  const camX = state.cameraOffset.x;
  const camY = state.cameraOffset.y;

  // For feed/grid, center content horizontally using an offset
  let centerOffsetX = 0;
  if (activeLayout === "feed" || activeLayout === "grid") {
    centerOffsetX = Math.floor((vw - totalWidth) / 2);
  }

  const visibleThisFrame = new Set();

  for (let i = 0; i < layoutItems.length; i++) {
    const item = layoutItems[i];

    const worldX = item.x + centerOffsetX;
    const worldY = item.y;
    const sx = worldX - camX;
    const sy = worldY - camY;

    const txs = worldX - state.targetOffset.x;
    const tys = worldY - state.targetOffset.y;

    const visibleAtCam =
      sx + item.w >= -buf && sx <= vw + buf &&
      sy + item.h >= -buf && sy <= vh + buf;
    const visibleAtTarget =
      txs + item.w >= -buf && txs <= vw + buf &&
      tys + item.h >= -buf && tys <= vh + buf;

    if (!visibleAtCam && !visibleAtTarget) continue;

    const visKey = item.key;
    visibleThisFrame.add(visKey);

    const existing = activeMap.get(visKey);
    if (existing) {
      if (existing.poolEl !== lightboxEl) {
        existing.poolEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      }
      // Update hidden state in edit mode
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

      // Show/hide video badge
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
      activeMap.set(visKey, {
        poolEl: el,
        layoutItem: item,
        screenX: sx,
        screenY: sy,
      });
    }
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

const openLightbox = (el, mediaItem) => {
  if (state.lightboxOpen || state.lightboxAnimating) return;

  const post = mediaItem?.post;
  const image = mediaItem?.image;

  state.lightboxAnimating = true;
  state.lightboxOpen = true;
  state.lightboxItem = { element: el, mediaItem };

  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = vw * 0.7;
  const maxH = vh * 0.7;

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
  const endX = (vw - targetW) / 2;
  const endY = (vh - targetH) / 2;

  el.style.visibility = "hidden";

  lightboxClone = document.createElement("div");
  lightboxClone.className = "grid-item lightbox-active";
  lightboxClone.style.width = `${startW}px`;
  lightboxClone.style.height = `${startH}px`;
  lightboxClone.style.display = "";
  lightboxClone.style.visibility = "visible";
  lightboxClone.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;

  if (image) {
    if (image.type === "video" && image.videoUrl) {
      const video = document.createElement("video");
      video.src = `/api/video-proxy?src=${encodeURIComponent(image.videoUrl)}`;
      video.poster = twitterImageUrl(image.url, "medium");
      video.controls = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.muted = true;
      video.autoplay = true;
      video.loop = true;
      video.setAttribute("loop", "");
      video.preload = "metadata";
      video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:12px;opacity:1;pointer-events:auto;z-index:999;";
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = 0;
      });
      video.addEventListener("canplay", () => {
        const promise = video.play();
        if (promise && promise.catch) promise.catch(() => {});
      });
      video.addEventListener("error", (event) => {
        console.error("Video playback error", event);
      });
      lightboxClone.appendChild(video);
      lightboxClone.classList.add("lightbox-video");
    } else {
      const hiRes = new Image();
      hiRes.src = twitterImageUrl(image.url, "4096x4096");
      hiRes.alt = "";
      hiRes.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:12px;opacity:0;transition:opacity 0.3s ease;";
      hiRes.onload = () => { hiRes.style.opacity = "1"; };
      lightboxClone.appendChild(hiRes);
    }
  }
  document.body.appendChild(lightboxClone);

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
  });
};

const closeLightbox = () => {
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
    el.style.visibility = "";
    state.lightboxOpen = false;
    state.lightboxItem = null;
    state.lightboxAnimating = false;
  });
};

// --- Input Handlers ---

const getDragScale = (isTouch) => {
  if (!isTouch) return 1;
  const width = window.innerWidth;
  if (width <= 420) return 1.05;
  if (width <= 620) return 1.0;
  if (width <= 820) return 0.95;
  return 0.9;
};

const onMouseDown = (e) => {
  if (state.lightboxOpen) return;
  state.isDragging = true;
  state.hasDragged = false;
  state.dragStartPosition = { x: e.clientX, y: e.clientY };
  state.velocity.x = 0;
  state.velocity.y = 0;
  viewport.classList.add("grabbing");
  state.previousMousePosition = { x: e.clientX, y: e.clientY };
};

const applyDragDelta = (dx, dy, isTouch = false) => {
  const bounds = getScrollBounds();
  const scale = getDragScale(isTouch);
  const dampen = (value, min, max) => {
    if (value < min) return min + (value - min) * 0.35;
    if (value > max) return max + (value - max) * 0.35;
    return value;
  };

  const scaledDx = dx * scale;
  const scaledDy = dy * scale;

  state.targetOffset.x = dampen(state.targetOffset.x - scaledDx, bounds.minX, bounds.maxX);
  state.targetOffset.y = dampen(state.targetOffset.y - scaledDy, bounds.minY, bounds.maxY);
  state.velocity.x = -scaledDx;
  state.velocity.y = -scaledDy;
};

const onMouseMove = (e) => {
  if (!state.isDragging) return;

  const totalDx = e.clientX - state.dragStartPosition.x;
  const totalDy = e.clientY - state.dragStartPosition.y;
  if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > DRAG_THRESHOLD) {
    state.hasDragged = true;
  }

  const lockX = activeLayout === "feed" || activeLayout === "grid";
  if (!lockX) applyDragDelta(e.clientX - state.previousMousePosition.x, 0, false);
  applyDragDelta(0, e.clientY - state.previousMousePosition.y, false);
  state.cameraOffset.x = state.targetOffset.x;
  state.cameraOffset.y = state.targetOffset.y;
  renderVisibleItems();
  state.previousMousePosition = { x: e.clientX, y: e.clientY };
};

const onMouseUp = (e) => {
  const wasDragging = state.isDragging;
  state.isDragging = false;
  viewport.classList.remove("grabbing");
  clampAllOffsets();

  if (wasDragging && !state.hasDragged && !state.lightboxOpen) {
    const target = e.target.closest(".grid-item");
    if (target) {
      const mediaItem = elToMediaItem.get(target);
      if (!mediaItem) return;

      if (editMode) {
        // Toggle visibility in edit mode with smooth animation
        toggleMediaHidden(mediaItem);
        saveHiddenIds();
        updateEditCounter();
        // Animate the toggle smoothly — just update class, CSS handles transition
        renderVisibleItems();
      } else {
        openLightbox(target, mediaItem);
      }
    }
  }
};

const onTouchStart = (e) => {
  if (e.touches.length === 1) {
    state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
};

const onTouchMove = (e) => {
  if (e.touches.length === 1 && state.touchStart) {
    e.preventDefault();
    const lockX = activeLayout === "feed" || activeLayout === "grid";
    if (!lockX) applyDragDelta(e.touches[0].clientX - state.touchStart.x, 0, true);
    applyDragDelta(0, e.touches[0].clientY - state.touchStart.y, true);
    state.cameraOffset.x = state.targetOffset.x;
    state.cameraOffset.y = state.targetOffset.y;
    renderVisibleItems();
    state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
};

const onTouchEnd = () => {
  state.touchStart = null;
};

const onWheel = (e) => {
  e.preventDefault();
  if (state.lightboxOpen) return;
  const lockX = activeLayout === "feed" || activeLayout === "grid";
  if (!lockX) state.targetOffset.x += e.deltaX;
  state.targetOffset.y += e.deltaY;
  clampTargetOffset();
};

const onWindowResize = () => {
  buildLayout();
  clampAllOffsets();
  for (const [visKey, entry] of activeMap) {
    releaseElement(entry.poolEl);
    activeMap.delete(visKey);
  }
  renderVisibleItems();
};

// --- Animation Loop ---

const animate = () => {
  requestAnimationFrame(animate);

  const bounds = getScrollBounds();

  if (!state.isDragging) {
    const friction = window.innerWidth <= 420 ? 0.96 : window.innerWidth <= 820 ? 0.92 : 0.95;
    state.targetOffset.x += state.velocity.x;
    state.targetOffset.y += state.velocity.y;
    state.velocity.x *= friction;
    state.velocity.y *= friction;

    if (Math.abs(state.velocity.x) < 0.03) state.velocity.x = 0;
    if (Math.abs(state.velocity.y) < 0.03) state.velocity.y = 0;

    if (state.targetOffset.x < bounds.minX) {
      state.targetOffset.x += (bounds.minX - state.targetOffset.x) * 0.15;
      state.velocity.x *= 0.6;
    }
    if (state.targetOffset.x > bounds.maxX) {
      state.targetOffset.x -= (state.targetOffset.x - bounds.maxX) * 0.15;
      state.velocity.x *= 0.6;
    }
    if (state.targetOffset.y < bounds.minY) {
      state.targetOffset.y += (bounds.minY - state.targetOffset.y) * 0.15;
      state.velocity.y *= 0.6;
    }
    if (state.targetOffset.y > bounds.maxY) {
      state.targetOffset.y -= (state.targetOffset.y - bounds.maxY) * 0.15;
      state.velocity.y *= 0.6;
    }
  }

  const dx = state.targetOffset.x - state.cameraOffset.x;
  const dy = state.targetOffset.y - state.cameraOffset.y;

  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    state.cameraOffset.x += dx * GRID_CONFIG.easingFactor;
    state.cameraOffset.y += dy * GRID_CONFIG.easingFactor;
    renderVisibleItems();
  }
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

const applyLayout = (layout) => {
  if (isTransitioning) return;
  isTransitioning = true;
  activeLayout = layout;

  // Update body class for cursor styling
  document.body.classList.remove("layout-masonry", "layout-grid", "layout-feed");
  document.body.classList.add(`layout-${layout}`);

  grid.style.transition = "opacity 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
  grid.style.opacity = "0";

  setTimeout(() => {
    state.cameraOffset.x = 0;
    state.cameraOffset.y = 0;
    state.targetOffset.x = 0;
    state.targetOffset.y = 0;

    for (const [visKey, entry] of activeMap) {
      releaseElement(entry.poolEl);
      activeMap.delete(visKey);
    }

    buildLayout();
    clampAllOffsets();
    renderVisibleItems();

    void grid.offsetHeight;
    grid.style.transition = "opacity 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
    grid.style.opacity = "1";

    setTimeout(() => {
      grid.style.transition = "";
      isTransitioning = false;
    }, 250);
  }, 200);
};

// --- Edit mode ---

const saveHiddenIds = () => {
  saveLocalHiddenState();

  fetch("/api/hidden", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getHiddenState()),
  }).catch(() => {
    // Static deployments cannot write portfolio.config.json; localStorage keeps edits in this browser.
  });
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

    // Rebuild to show/hide hidden posts
    for (const [visKey, entry] of activeMap) {
      releaseElement(entry.poolEl);
      activeMap.delete(visKey);
    }
    buildLayout();
    renderVisibleItems();
  });

  return wrapper;
};

// --- Theme toggle ---

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
  btn.innerHTML = `<img src="assets/info.svg" alt="Info" width="18" height="18">`;
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleInfoPopover(btn);
  });
  return btn;
};

const positionInfoPopover = (buttonEl) => {
  if (!infoPopoverEl || !buttonEl) return;
  const rect = buttonEl.getBoundingClientRect();
  const { width: popoverWidth, height: popoverHeight } = infoPopoverEl.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - popoverWidth / 2;
  let top = rect.top - popoverHeight - 10;
  let adjustedLeft = Math.min(Math.max(12, left), window.innerWidth - popoverWidth - 12);
  if (top < 12) top = rect.bottom + 10;
  infoPopoverEl.style.left = `${adjustedLeft}px`;
  infoPopoverEl.style.top = `${top}px`;
};

const createInfoPopover = () => {
  const popover = document.createElement("div");
  popover.id = "info-popover";
  popover.className = "info-popover";
  popover.addEventListener("click", (event) => event.stopPropagation());
  document.body.appendChild(popover);
  infoPopoverEl = popover;
  renderInfoPopover();
};

const renderInfoPopover = () => {
  if (!infoPopoverEl) return;

  const handle = CONFIG?.handle || PROFILE?.handle || PROFILE?.name || "";
  const displayName = PROFILE?.name || handle;
  const avatar = PROFILE?.avatar || "";
  const bio = PROFILE_DETAILS.shortBio || PROFILE?.bio || "";
  const websiteUrl = PROFILE_DETAILS.websiteUrl || PROFILE?.url || "";
  const twitterUrl = PROFILE?.url || `https://x.com/${handle}`;
  const sourceCodeUrl = PROFILE_DETAILS.sourceCodeUrl || "";

  infoPopoverEl.innerHTML = `
    <div class="info-popover-header">
      <img class="info-avatar" src="${avatar}" alt="${displayName} avatar">
      <div>
        <div class="info-name">${displayName}</div>
        <a class="info-handle" href="${twitterUrl}" target="_blank" rel="noopener">@${handle}</a>
      </div>
    </div>
    <div class="info-bio">${bio}</div>
    <div class="info-actions">
      ${websiteUrl ? `<a class="info-link" href="${websiteUrl}" target="_blank" rel="noopener">${PROFILE_DETAILS.websiteLabel || "Website"}</a>` : ""}
      ${sourceCodeUrl ? `<a class="info-link" href="${sourceCodeUrl}" target="_blank" rel="noopener">Source code</a>` : ""}
    </div>
  `;
};

const positionInfoPopoverHandler = (buttonEl) => () => positionInfoPopover(buttonEl);

const closeInfoPopover = () => {
  if (!infoPopoverEl) return;
  infoPopoverEl.classList.remove("visible");
  document.removeEventListener("click", onDocumentClickCloseInfo);
  window.removeEventListener("keydown", onDocumentKeyDownCloseInfo);
  window.removeEventListener("resize", infoPopoverResizeHandler);
};

let infoPopoverResizeHandler = null;

const toggleInfoPopover = (buttonEl) => {
  if (!infoPopoverEl) createInfoPopover();
  const isVisible = infoPopoverEl.classList.toggle("visible");
  renderInfoPopover();
  if (isVisible) {
    positionInfoPopover(buttonEl);
    document.addEventListener("click", onDocumentClickCloseInfo);
    window.addEventListener("keydown", onDocumentKeyDownCloseInfo);
    infoPopoverResizeHandler = positionInfoPopoverHandler(buttonEl);
    window.addEventListener("resize", infoPopoverResizeHandler);
  } else {
    document.removeEventListener("click", onDocumentClickCloseInfo);
    window.removeEventListener("keydown", onDocumentKeyDownCloseInfo);
    if (infoPopoverResizeHandler) {
      window.removeEventListener("resize", infoPopoverResizeHandler);
      infoPopoverResizeHandler = null;
    }
  }
};

const onDocumentClickCloseInfo = (event) => {
  if (!infoPopoverEl?.contains(event.target) && event.target.id !== "info-toggle") {
    closeInfoPopover();
  }
};

const onDocumentKeyDownCloseInfo = (event) => {
  if (event.key === "Escape") {
    closeInfoPopover();
  }
};

// --- Profile header ---

const createProfileHeader = () => {
  if (!PROFILE) return;

  const header = document.createElement("a");
  header.id = "profile-header";
  header.className = "profile-header";
  header.href = PROFILE.url;
  header.target = "_blank";
  header.rel = "noopener";

  header.innerHTML = `<span class="profile-handle">@${CONFIG?.handle || PROFILE.handle || PROFILE.name}</span>`;

  document.body.appendChild(header);
};

// --- Toolbar ---

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
  rightGroup.appendChild(createThemeToggle());
  toolbar.appendChild(rightGroup);

  const infoButtonGroup = document.createElement("div");
  infoButtonGroup.className = "toolbar-group";
  infoButtonGroup.appendChild(createInfoToggle());
  toolbar.appendChild(infoButtonGroup);

  document.body.appendChild(toolbar);
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
  clampAllOffsets();
  createPool();
  renderVisibleItems();
  createProfileHeader();
  createToolbar();

  // Pre-warm Motion
  const warmup = document.createElement("div");
  warmup.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
  document.body.appendChild(warmup);
  Motion.animate(warmup, { opacity: [0, 1] }, { duration: 0.01 }).then(() => warmup.remove());

  viewport.addEventListener("mousedown", onMouseDown);
  viewport.addEventListener("mousemove", onMouseMove);
  viewport.addEventListener("mouseup", onMouseUp);
  viewport.addEventListener("mouseleave", onMouseUp);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("touchstart", onTouchStart);
  viewport.addEventListener("touchmove", onTouchMove, { passive: false });
  viewport.addEventListener("touchend", onTouchEnd);
  window.addEventListener("resize", onWindowResize);

  lightboxClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeLightbox();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLightbox();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.lightboxOpen) closeLightbox();
  });

  animate();
};

init();
