const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// API endpoint to save hidden IDs to config
const handleApi = (req, res) => {
  if (req.method === "POST" && req.url === "/api/hidden") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { hiddenIds, hiddenMediaIds } = JSON.parse(body);
        const configPath = path.join(__dirname, "portfolio.config.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        config.hiddenIds = hiddenIds || [];
        config.hiddenMediaIds = hiddenMediaIds || [];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  if (req.method === "GET" && req.url?.startsWith("/api/video-proxy")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const src = url.searchParams.get("src");
    if (!src) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing src parameter" }));
      return true;
    }

    let remoteUrl;
    try {
      remoteUrl = new URL(src);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid src URL" }));
      return true;
    }

    const proxyOptions = {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        Accept: "video/*,*/*;q=0.8",
        Referer: "https://twitter.com/",
        Origin: "https://twitter.com",
      },
    };

    const requester = remoteUrl.protocol === "https:" ? https : http;
    const remoteReq = requester.request(remoteUrl, proxyOptions, (remoteRes) => {
      const headers = {
        "Content-Type": remoteRes.headers["content-type"] || "application/octet-stream",
        "Content-Length": remoteRes.headers["content-length"] || undefined,
        "Accept-Ranges": remoteRes.headers["accept-ranges"] || "bytes",
        "Cache-Control": remoteRes.headers["cache-control"] || "no-cache",
        "Access-Control-Allow-Origin": "*",
      };
      res.writeHead(remoteRes.statusCode || 502, headers);
      remoteRes.pipe(res);
    });

    remoteReq.on("error", (error) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    });

    remoteReq.end();
    return true;
  }

  return false;
};

http
  .createServer((req, res) => {
    if (handleApi(req, res)) return;

    let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);
    const ext = path.extname(filePath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Portfolio running at http://localhost:${PORT}`));
