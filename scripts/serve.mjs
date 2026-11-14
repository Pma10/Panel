import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve(process.cwd());
const port = Number(process.env.PORT || 4173);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const dest = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (dest !== root && !dest.startsWith(root + sep)) { res.writeHead(403); return res.end("Forbidden"); }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); return res.end("Method not allowed"); }
    const info = await stat(dest);
    if (!info.isFile()) throw new Error("Not a file");
    const data = await readFile(dest);
    res.writeHead(200, { "content-type": mime[extname(dest)] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    return res.end(req.method === "HEAD" ? undefined : data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write("피컨 미리보기: http://127.0.0.1:" + port + "\n");
});
