import {createServer} from "node:http";
import {randomBytes, timingSafeEqual} from "node:crypto";
import {createReadStream} from "node:fs";
import {realpath, stat} from "node:fs/promises";
import {extname, relative, resolve, sep} from "node:path";
import {Readable} from "node:stream";
import {fileURLToPath} from "node:url";
import {askFromLocalPreview} from "./dist/server/index.js";
import {handlePdfTools} from "./dist/server/pdf-tools.mjs";

const host = "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".pdf": "application/pdf",
  ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".woff2": "font/woff2"
};

export async function startReaderHost({port = 0, webOrigins = [], env = process.env} = {}) {
  const root = await realpath(fileURLToPath(new URL("./dist/client/", import.meta.url)));
  const allowed = new Set(webOrigins.map(value => {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== value ||
        (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("Expected an exact HTTPS or loopback origin: " + value);
    }
    return url.origin;
  }));
  const pairingCode = allowed.size ? randomBytes(24).toString("base64url") : null;
  const expected = pairingCode && Buffer.from("Bearer " + pairingCode);
  let origin;
  const server = createServer(async (incoming, outgoing) => {
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    if (incoming.headers.host !== new URL(origin).host) {
      outgoing.writeHead(421).end("Use the printed loopback address.");
      return;
    }
    try {
      const url = new URL(incoming.url, origin);
      if (url.origin !== origin) { outgoing.writeHead(400).end(); return; }
      const path = url.pathname, method = incoming.method;
      const source = incoming.headers.origin;
      if (path === "/api/reader/status" || path === "/api/deepseek" || path.startsWith("/api/pdf-tools/")) {
        outgoing.setHeader("Cache-Control", "no-store");
        outgoing.setHeader("Vary", "Origin");
        if (source && source !== origin) {
          if (!allowed.has(source)) { outgoing.writeHead(403).end(); return; }
          outgoing.setHeader("Access-Control-Allow-Origin", source);
          if (method === "OPTIONS") {
            outgoing.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            outgoing.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            if (incoming.headers["access-control-request-private-network"] === "true") {
              outgoing.setHeader("Access-Control-Allow-Private-Network", "true");
            }
            outgoing.writeHead(204).end();
            return;
          }
          const supplied = Buffer.from(incoming.headers.authorization || "");
          if (!expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            outgoing.writeHead(401, {"Content-Type": "application/json; charset=utf-8"});
            outgoing.end(JSON.stringify({message: "配对码有误。请使用后端窗口显示的配对码。"}));
            return;
          }
        }
        if (path === "/api/reader/status" && method === "GET") {
          outgoing.writeHead(200, {"Content-Type": "application/json; charset=utf-8"}).end('{"readerApi":1}');
          return;
        }
        if (method !== "GET" && method !== "POST") { outgoing.writeHead(405).end(); return; }
        const hasBody = method === "POST";
        const request = new Request(url, {method, headers: incoming.headers,
          body: hasBody ? Readable.toWeb(incoming) : undefined, duplex: hasBody ? "half" : undefined});
        const trustedOrigin = source || origin;
        const result = path === "/api/deepseek" ? await askFromLocalPreview(request, env, trustedOrigin)
          : await handlePdfTools(request, env, true, trustedOrigin);
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        if (result.body) Readable.fromWeb(result.body).on("error", () => outgoing.destroy()).pipe(outgoing);
        else outgoing.end();
        return;
      }
      if (method !== "GET" && method !== "HEAD") { outgoing.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(path === "/" ? "/index.html" : path);
      const file = await realpath(resolve(root, "." + pathname));
      const rel = relative(root, file);
      if (!rel || rel === ".." || rel.startsWith(".." + sep) || resolve(root, rel) !== file) {
        outgoing.writeHead(404).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) { outgoing.writeHead(404).end(); return; }
      outgoing.writeHead(200, {"Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": info.size, "Cache-Control": "no-cache"});
      if (method === "HEAD") outgoing.end();
      else createReadStream(file).on("error", () => outgoing.destroy()).pipe(outgoing);
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(error.code === "ENOENT" ? 404 : 400);
      outgoing.end();
    }
  });
  await new Promise((listen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      origin = "http://" + host + ":" + server.address().port;
      server.off("error", reject);
      listen();
    });
  });
  return {origin, pairingCode, close: () => new Promise((done, reject) => {
    server.close(error => error ? reject(error) : done());
  })};
}
