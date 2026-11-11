// Reads your x.com login (ct0 + auth_token cookies) from whichever browser on
// this Mac is signed in. Supports Chromium browsers (Chrome, Arc, Brave, Edge,
// Dia, Comet, Vivaldi, Opera, Helium, Chromium…), Firefox-family browsers
// (Firefox, Zen, LibreWolf, Waterfox) and Safari.
//
// Browsers that are not installed are skipped quietly. The configured browser
// is tried first; if it is missing or not logged in, every other installed
// browser is tried before giving up, and the final error lists what was checked.

const { execFileSync } = require("child_process");
const { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } = require("fs");
const { join } = require("path");
const { tmpdir, homedir } = require("os");
const { pbkdf2Sync, createDecipheriv } = require("crypto");

const HOME = homedir();
const APP_SUPPORT = join(HOME, "Library/Application Support");
const COOKIE_NAMES = ["ct0", "auth_token"];
const X_HOSTS = ["x.com", ".x.com", "twitter.com", ".twitter.com"];

// keychain: "Safe Storage" service names to try, first match wins.
const CHROMIUM_BROWSERS = {
  chrome: { label: "Chrome", dir: "Google/Chrome", keychain: ["Chrome Safe Storage", "Google Chrome Safe Storage"] },
  "chrome-beta": { label: "Chrome Beta", dir: "Google/Chrome Beta", keychain: ["Chrome Safe Storage", "Chrome Beta Safe Storage"] },
  "chrome-canary": { label: "Chrome Canary", dir: "Google/Chrome Canary", keychain: ["Chrome Safe Storage", "Chrome Canary Safe Storage"] },
  arc: { label: "Arc", dir: "Arc/User Data", keychain: ["Arc Safe Storage"] },
  dia: { label: "Dia", dir: "Dia/User Data", keychain: ["Dia Safe Storage"] },
  brave: { label: "Brave", dir: "BraveSoftware/Brave-Browser", keychain: ["Brave Safe Storage", "Brave Browser Safe Storage"] },
  edge: { label: "Microsoft Edge", dir: "Microsoft Edge", keychain: ["Microsoft Edge Safe Storage"] },
  comet: { label: "Comet", dir: "Comet", keychain: ["Comet Safe Storage"] },
  vivaldi: { label: "Vivaldi", dir: "Vivaldi", keychain: ["Vivaldi Safe Storage"] },
  opera: { label: "Opera", dir: "com.operasoftware.Opera", keychain: ["Opera Safe Storage"], rootProfile: true },
  "opera-gx": { label: "Opera GX", dir: "com.operasoftware.OperaGX", keychain: ["Opera Safe Storage", "Opera GX Safe Storage"], rootProfile: true },
  helium: { label: "Helium", dir: "net.imput.helium", keychain: ["Helium Storage Key", "Helium Safe Storage"] },
  chromium: { label: "Chromium", dir: "Chromium", keychain: ["Chromium Safe Storage"] },
};

const FIREFOX_BROWSERS = {
  firefox: { label: "Firefox", dir: "Firefox/Profiles" },
  zen: { label: "Zen", dir: "zen/Profiles" },
  librewolf: { label: "LibreWolf", dir: "librewolf/Profiles" },
  waterfox: { label: "Waterfox", dir: "Waterfox/Profiles" },
};

const SAFARI_COOKIE_FILES = [
  join(HOME, "Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"),
  join(HOME, "Library/Cookies/Cookies.binarycookies"),
];

const ALIASES = {
  "google-chrome": "chrome",
  "google chrome": "chrome",
  "microsoft-edge": "edge",
  "brave-browser": "brave",
  operagx: "opera-gx",
  "zen-browser": "zen",
};

const ALL_BROWSERS = [...Object.keys(CHROMIUM_BROWSERS), ...Object.keys(FIREFOX_BROWSERS), "safari"];

const labelOf = (key) =>
  CHROMIUM_BROWSERS[key]?.label || FIREFOX_BROWSERS[key]?.label || (key === "safari" ? "Safari" : key);

const normalizeBrowser = (name) => {
  const key = String(name || "").trim().toLowerCase().replace(/\s+/g, "-");
  return ALIASES[key] || ALIASES[key.replace(/-/g, " ")] || key;
};

// --- Helpers ---

const sqliteJson = (dbPath, sql) => {
  const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return out ? JSON.parse(out) : [];
};

// Browsers keep their cookie DB open (and Firefox writes through a WAL), so
// always read a private copy, including any -wal/-shm sidecars.
const withDbCopy = (dbPath, read) => {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-sync-"));
  const copy = join(dir, "cookies.db");
  try {
    copyFileSync(dbPath, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix);
    }
    return read(copy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const hostList = X_HOSTS.map((host) => `'${host}'`).join(",");
const nameList = COOKIE_NAMES.map((name) => `'${name}'`).join(",");

// Prefer x.com over the legacy twitter.com cookies when both exist.
const pickCookies = (rows) => {
  const found = {};
  const rank = (host) => (host.replace(/^\./, "") === "x.com" ? 0 : 1);
  for (const row of [...rows].sort((a, b) => rank(a.host) - rank(b.host))) {
    if (row.value && !found[row.name]) found[row.name] = row.value;
  }
  return found;
};

// --- Chromium ---

const chromiumProfiles = (browser, profile) => {
  const root = join(APP_SUPPORT, browser.dir);
  if (!existsSync(root)) return null;

  const names = profile ? [profile] : browser.rootProfile ? [""] : ["Default"];
  if (!profile && !browser.rootProfile) {
    try {
      for (const name of readdirSync(root)) {
        if (/^Profile \d+$/.test(name) || name === "Guest Profile") names.push(name);
      }
    } catch {}
  }

  // Chrome 96+ keeps cookies under Network/; older builds and some forks don't.
  return [...new Set(names)]
    .flatMap((name) => [join(root, name, "Network", "Cookies"), join(root, name, "Cookies")])
    .filter(existsSync);
};

const keychainKeyCache = new Map();
const chromiumKey = (browser) => {
  if (keychainKeyCache.has(browser.label)) return keychainKeyCache.get(browser.label);
  for (const service of browser.keychain) {
    try {
      const password = execFileSync("security", ["find-generic-password", "-w", "-s", service], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (password) {
        const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
        keychainKeyCache.set(browser.label, key);
        return key;
      }
    } catch {}
  }
  keychainKeyCache.set(browser.label, null);
  return null;
};

const decryptChromium = (hex, key, dbVersion) => {
  const buf = Buffer.from(hex, "hex");
  const prefix = buf.subarray(0, 3).toString("latin1");
  if (prefix !== "v10" && prefix !== "v11") return "";
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  let plain = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
  // DB version 24+ prefixes the value with a 32-byte SHA-256 of the host.
  if (dbVersion >= 24 && plain.length > 32) plain = plain.subarray(32);
  return plain.toString("utf8").replace(/\0+$/g, "").trim();
};

const readChromium = (browserKey, profile, log) => {
  const browser = CHROMIUM_BROWSERS[browserKey];
  const dbPaths = chromiumProfiles(browser, profile);
  if (dbPaths === null) return log(browserKey, "not installed");
  if (dbPaths.length === 0) return log(browserKey, "no cookie database (open it once)");

  for (const dbPath of dbPaths) {
    let rows;
    let dbVersion = 0;
    try {
      ({ rows, dbVersion } = withDbCopy(dbPath, (copy) => {
        let version = 0;
        try {
          version = parseInt(sqliteJson(copy, "SELECT value FROM meta WHERE key='version';")[0]?.value, 10) || 0;
        } catch {}
        const found = sqliteJson(
          copy,
          `SELECT host_key AS host, name, hex(encrypted_value) AS h, value FROM cookies WHERE host_key IN (${hostList}) AND name IN (${nameList});`
        );
        return { rows: found, dbVersion: version };
      }));
    } catch {
      continue;
    }
    if (!rows.some((row) => row.name === "ct0")) continue;

    // Only touch the Keychain once we know this profile is logged in, so
    // scanning many browsers doesn't trigger a password prompt for each one.
    const needsKey = rows.some((row) => !row.value && row.h);
    const key = needsKey ? chromiumKey(browser) : null;
    if (needsKey && !key) return log(browserKey, "logged in, but its Keychain key couldn't be read");

    const decoded = rows.map((row) => {
      let value = row.value || "";
      if (!value && row.h) {
        try {
          value = decryptChromium(row.h, key, dbVersion);
        } catch {
          value = "";
        }
      }
      return { host: row.host, name: row.name, value };
    });
    const cookies = pickCookies(decoded);
    if (cookies.ct0 && cookies.auth_token) return cookies;
  }
  return log(browserKey, "not logged in to x.com");
};

// --- Firefox family ---

const readFirefox = (browserKey, profile, log) => {
  const root = join(APP_SUPPORT, FIREFOX_BROWSERS[browserKey].dir);
  if (!existsSync(root)) return log(browserKey, "not installed");

  let profiles = [];
  try {
    profiles = readdirSync(root)
      .filter((name) => !profile || name === profile || name.endsWith(`.${profile}`))
      .map((name) => join(root, name, "cookies.sqlite"))
      .filter(existsSync);
  } catch {}
  if (profiles.length === 0) return log(browserKey, "no cookie database (open it once)");

  for (const dbPath of profiles) {
    try {
      const rows = withDbCopy(dbPath, (copy) =>
        sqliteJson(copy, `SELECT host, name, value FROM moz_cookies WHERE host IN (${hostList}) AND name IN (${nameList});`)
      );
      const cookies = pickCookies(rows);
      if (cookies.ct0 && cookies.auth_token) return cookies;
    } catch {}
  }
  return log(browserKey, "not logged in to x.com");
};

// --- Safari ---

// Cookies.binarycookies: big-endian header and page table, little-endian pages.
const parseBinaryCookies = (buf) => {
  if (buf.subarray(0, 4).toString("latin1") !== "cook") return [];
  const pageCount = buf.readUInt32BE(4);
  const pageSizes = Array.from({ length: pageCount }, (_, i) => buf.readUInt32BE(8 + i * 4));
  const cstring = (page, start) => {
    const end = page.indexOf(0, start);
    return page.subarray(start, end === -1 ? undefined : end).toString("utf8");
  };

  const rows = [];
  let offset = 8 + pageCount * 4;
  for (const size of pageSizes) {
    const page = buf.subarray(offset, offset + size);
    offset += size;
    const cookieCount = page.readUInt32LE(4);
    for (let i = 0; i < cookieCount; i++) {
      const at = page.readUInt32LE(8 + i * 4);
      const cookie = page.subarray(at, at + page.readUInt32LE(at));
      rows.push({
        host: cstring(cookie, cookie.readUInt32LE(16)),
        name: cstring(cookie, cookie.readUInt32LE(20)),
        value: cstring(cookie, cookie.readUInt32LE(28)),
      });
    }
  }
  return rows;
};

const readSafari = (_key, _profile, log) => {
  const file = SAFARI_COOKIE_FILES.find((path) => existsSync(path));
  if (!file) return log("safari", "no cookie file found");
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return log("safari", "blocked by macOS (give your terminal Full Disk Access to use Safari)");
  }
  try {
    const rows = parseBinaryCookies(buf).filter(
      (row) => X_HOSTS.includes(row.host) && COOKIE_NAMES.includes(row.name)
    );
    const cookies = pickCookies(rows);
    if (cookies.ct0 && cookies.auth_token) return cookies;
  } catch {}
  return log("safari", "not logged in to x.com");
};

// --- Public ---

const readBrowser = (key, profile, log) => {
  if (CHROMIUM_BROWSERS[key]) return readChromium(key, profile, log);
  if (FIREFOX_BROWSERS[key]) return readFirefox(key, profile, log);
  if (key === "safari") return readSafari(key, profile, log);
  return log(key, "unknown browser");
};

/**
 * Returns { csrfToken, cookieHeader, browser } for the first browser logged in
 * to x.com. `preferred` may be "auto", a browser name, or a list of names.
 */
function getXCookies({ preferred = "auto", profile = "" } = {}) {
  const wanted = (Array.isArray(preferred) ? preferred : [preferred])
    .map(normalizeBrowser)
    .filter((key) => key && key !== "auto");
  const unknown = wanted.filter((key) => !ALL_BROWSERS.includes(key));
  if (unknown.length) {
    console.warn(`Ignoring unknown browser ${unknown.map((k) => `"${k}"`).join(", ")}. Supported: ${ALL_BROWSERS.join(", ")}`);
  }
  const known = wanted.filter((key) => ALL_BROWSERS.includes(key));
  const order = [...known, ...ALL_BROWSERS.filter((key) => !known.includes(key))];

  const checked = [];
  const log = (key, reason) => {
    checked.push(`  ${labelOf(key)}: ${reason}`);
    return null;
  };

  for (const key of order) {
    // A profile name only makes sense for the browser it was configured for.
    const browserProfile = known.length && key === known[0] ? profile : "";
    const cookies = readBrowser(key, browserProfile, log);
    if (cookies) {
      if (known.length && !known.includes(key)) {
        console.warn(`${known.map(labelOf).join(" / ")} isn't available or logged in; using your x.com login from ${labelOf(key)} instead.`);
      }
      return {
        browser: labelOf(key),
        csrfToken: cookies.ct0,
        cookieHeader: `ct0=${cookies.ct0}; auth_token=${cookies.auth_token}`,
      };
    }
  }

  const installed = checked.filter((line) => !line.endsWith("not installed"));
  throw new Error(
    [
      "Couldn't find an x.com login in any browser on this Mac.",
      "Log in to x.com in any supported browser and run the sync again.",
      installed.length ? `Checked:\n${installed.join("\n")}` : "No supported browser was found.",
    ].join("\n")
  );
}

module.exports = { getXCookies, parseBinaryCookies, SUPPORTED_BROWSERS: ALL_BROWSERS };
