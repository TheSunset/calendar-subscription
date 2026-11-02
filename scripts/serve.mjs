#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = resolve(ROOT, "public");
const PORT = Number(process.env.PORT ?? 8000);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".ics": "text/calendar; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = resolve(PUBLIC_DIR, `.${requestedPath}`);
    if (!filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": file.size,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not Found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`本地预览：http://127.0.0.1:${PORT}`);
});
