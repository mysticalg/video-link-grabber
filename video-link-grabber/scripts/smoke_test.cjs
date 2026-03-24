const http = require("node:http");
const { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");


const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output", "playwright");


function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8"
  };
  return types[ext] || "application/octet-stream";
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const relativePath = urlPath === "/" ? "popup.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.normalize(path.join(rootDir, relativePath));

      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      createReadStream(filePath).pipe(res);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function extractScanFunctionSource() {
  const popupSource = readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const start = popupSource.indexOf("function scanPageForVideos()");
  const end = popupSource.indexOf("\nasync function scan()", start);

  if (start === -1 || end === -1) {
    throw new Error("Could not extract scanPageForVideos from popup.js");
  }

  return popupSource.slice(start, end).trim();
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const { server, origin } = await startStaticServer(ROOT);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`${origin}/fixtures/demo-page.html`, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: extractScanFunctionSource() });

    const scanResult = await page.evaluate(() => scanPageForVideos());
    const urls = scanResult.items.map((item) => item.url);
    const requiredMatches = ["flower.mp4", "x36xhzz.m3u8", "bbb_30fps.mpd"];
    const missing = requiredMatches.filter((needle) => !urls.some((url) => url.includes(needle)));

    if (missing.length) {
      throw new Error(`Smoke test failed. Missing expected URLs: ${missing.join(", ")}`);
    }

    const previewPage = await browser.newPage({ viewport: { width: 430, height: 760 } });
    await previewPage.goto(`${origin}/popup.html?preview=1`, { waitUntil: "networkidle" });

    const popupShot = path.join(OUTPUT_DIR, "popup-preview.png");
    await previewPage.screenshot({ path: popupShot, fullPage: true });

    const report = {
      checkedAt: new Date().toISOString(),
      previewScreenshot: popupShot,
      scannedPage: `${origin}/fixtures/demo-page.html`,
      itemCount: scanResult.items.length,
      urls
    };

    writeFileSync(path.join(OUTPUT_DIR, "smoke-test-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
