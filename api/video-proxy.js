import https from "https";

export default async function handler(req, res) {
  const { src } = req.query;
  if (!src) {
    res.status(400).json({ error: "Missing src parameter" });
    return;
  }

  let remoteUrl;
  try {
    remoteUrl = new URL(src);
  } catch (err) {
    res.status(400).json({ error: "Invalid src URL" });
    return;
  }

  const requestOptions = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
      Accept: "video/*,*/*;q=0.8",
      Referer: "https://twitter.com/",
      Origin: "https://twitter.com",
    },
  };

  const proxyRequest = https.get(remoteUrl, requestOptions, (proxyRes) => {
    const headers = {
      "Content-Type": proxyRes.headers["content-type"] || "application/octet-stream",
      "Content-Length": proxyRes.headers["content-length"] || undefined,
      "Accept-Ranges": proxyRes.headers["accept-ranges"] || "bytes",
      "Cache-Control": proxyRes.headers["cache-control"] || "no-cache",
      "Access-Control-Allow-Origin": "*",
    };

    res.writeHead(proxyRes.statusCode || 502, headers);
    proxyRes.pipe(res);
  });

  proxyRequest.on("error", (error) => {
    res.status(502).json({ error: error.message });
  });
}
