// Tiny local server for dist/ (same URL shapes as Cloudflare Pages: /path/ serves /path/index.html).
// Usage: node scripts/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { p } from "./lib/util.mjs";

const port = +(process.argv[2] || process.env.PORT || 8790);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png" };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(p("dist"), url);
  if (!file.startsWith(p("dist"))) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404, { "content-type": TYPES[".html"] }); res.end(fs.existsSync(p("dist", "404.html")) ? fs.readFileSync(p("dist", "404.html")) : "Not found"); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving dist/ on http://localhost:${port} (this PC only)`));
