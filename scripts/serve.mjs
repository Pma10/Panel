import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};
const MAX_STATIC_BYTES = 6 * 1024 * 1024;

function isPublicPath(pathname) {
  return pathname === "/index.html" ||
    /^\/src\/[a-zA-Z0-9_-]+\.(?:js|mjs|css)$/.test(pathname) ||
    /^\/assets\/[a-zA-Z0-9_.-]+\.(?:svg|png|webp|woff2)$/.test(pathname);
}

/** Streams allowlisted static assets instead of allocating a full buffer per request. */
export function createStaticServer(root = process.cwd()) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { "Allow": "GET, HEAD", "X-Content-Type-Options": "nosniff" });
      res.end("Method not allowed");
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400);
      res.end("Invalid path");
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/panel-config.js") {
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(req.method === "HEAD" ? undefined : 'window.PCONN_API_BASE = "";');
      return;
    }
    if (!isPublicPath(pathname)) {
      res.writeHead(404, { "X-Content-Type-Options": "nosniff" });
      res.end("Not found");
      return;
    }

    try {
      const path = resolve(base, "." + pathname);
      // realpath also rejects symlinks that escape the repository root.
      const real = await realpath(path);
      if (!real.startsWith(base + sep) || real === base) throw new Error("Invalid file");
      const file = await stat(real);
      if (!file.isFile() || file.size > MAX_STATIC_BYTES) throw new Error("Invalid file");

      const modified = file.mtime.toUTCString();
      const headers = {
        "Content-Type": TYPES[extname(real)] || "application/octet-stream",
        "Content-Length": String(file.size),
        "Last-Modified": modified,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      };
      if (req.headers["if-modified-since"] === modified) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(real, { highWaterMark: 32 * 1024 });
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(404, { "X-Content-Type-Options": "nosniff" });
        res.end("Not found");
      } else res.destroy();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  createStaticServer().listen(port, "127.0.0.1", () => {
    process.stdout.write("Panel 미리보기: http://127.0.0.1:" + port + "\n");
  });
}
