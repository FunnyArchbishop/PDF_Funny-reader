import {createServer} from "node:http";
import {createReadStream} from "node:fs";
import {realpath, stat} from "node:fs/promises";
import {extname, relative, resolve, sep} from "node:path";
import {Readable} from "node:stream";
import {fileURLToPath} from "node:url";
import {askFromLocalPreview} from "./dist/server/index.js";

const root = await realpath(fileURLToPath(new URL("./dist/client/", import.meta.url)));
const port = Number(process.env.READER_PORT || 4174);
const origin = "http://127.0.0.1:" + port;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".pdf": "application/pdf",
  ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".woff2": "font/woff2"
};

const server = createServer(async (incoming, outgoing) => {
  outgoing.setHeader("X-Content-Type-Options", "nosniff");
  if (incoming.headers.host !== new URL(origin).host) {
    outgoing.writeHead(421).end("Use the printed loopback address.");
    return;
  }
  try {
    const url = new URL(incoming.url, origin);
    if (url.origin !== origin) { outgoing.writeHead(400).end(); return; }
    if (url.pathname === "/api/deepseek") {
      const method = incoming.method;
      const hasBody = method !== "GET" && method !== "HEAD";
      const request = new Request(url, {method, headers: incoming.headers,
        body: hasBody ? Readable.toWeb(incoming) : undefined, duplex: hasBody ? "half" : undefined});
      const result = await askFromLocalPreview(request, process.env);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if (incoming.method !== "GET" && incoming.method !== "HEAD") { outgoing.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
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
    if (incoming.method === "HEAD") outgoing.end();
    else createReadStream(file).on("error", () => outgoing.destroy()).pipe(outgoing);
  } catch (error) {
    if (!outgoing.headersSent) outgoing.writeHead(error.code === "ENOENT" ? 404 : 400);
    outgoing.end();
  }
});
server.listen(port, "127.0.0.1", () => console.log("Local: " + origin));
