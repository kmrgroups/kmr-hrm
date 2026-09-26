// Local stand-in for the Supabase API gateway on :54321
//   /auth/v1/*    -> Supabase Auth (GoTrue) on :9999
//   /rest/v1/*    -> PostgREST on :3001
//   /storage/v1/* -> a minimal file store implementing the Storage API calls the app uses
import http from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = process.env.STORAGE_DIR || "/tmp/claude-0/stack/storage";
const tokens = new Map(); // token -> { bucket, path, kind, exp }
const PUBLIC_BUCKETS = new Set(["branding"]);

function forward(req, res, port, path) {
  const p = http.request({ host: "127.0.0.1", port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}

const body = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const file = (bucket, path) => join(ROOT, bucket, path);

async function fileFromBody(req, buf) {
  const ct = req.headers["content-type"] || "";
  if (ct.startsWith("multipart/form-data")) {
    const fd = await new Response(buf, { headers: { "content-type": ct } }).formData();
    for (const [, v] of fd.entries()) if (typeof v !== "string") return { data: Buffer.from(await v.arrayBuffer()), type: v.type };
  }
  return { data: buf, type: ct };
}
function save(bucket, path, data, type) {
  const f = file(bucket, path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, data);
  writeFileSync(f + ".type", type || "application/octet-stream");
}
function sendFile(res, bucket, path) {
  const f = file(bucket, path);
  if (!existsSync(f)) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
  res.writeHead(200, { "content-type": existsSync(f + ".type") ? readFileSync(f + ".type", "utf8") : "application/octet-stream" });
  res.end(readFileSync(f));
}

async function storage(req, res, url) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  const m = (re) => p.match(re);
  let r;
  if (req.method === "POST" && (r = m(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
    const token = randomBytes(16).toString("hex");
    tokens.set(token, { bucket: r[1], path: r[2], kind: "upload", exp: Date.now() + 7200e3 });
    return json(res, 200, { url: `/object/upload/sign/${r[1]}/${r[2]}?token=${token}` });
  }
  if (req.method === "PUT" && (r = m(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
    const t = tokens.get(url.searchParams.get("token"));
    if (!t || t.kind !== "upload" || t.bucket !== r[1] || t.path !== r[2]) return json(res, 400, { statusCode: "400", error: "InvalidSignature", message: "invalid token" });
    const { data, type } = await fileFromBody(req, await body(req));
    save(r[1], r[2], data, type);
    return json(res, 200, { Key: `${r[1]}/${r[2]}` });
  }
  if (req.method === "POST" && (r = m(/^\/object\/sign\/([^/]+)$/))) {
    const { paths, expiresIn } = JSON.parse((await body(req)).toString());
    return json(res, 200, paths.map((path) => {
      const token = randomBytes(16).toString("hex");
      tokens.set(token, { bucket: r[1], path, kind: "read", exp: Date.now() + expiresIn * 1000 });
      return { path, signedURL: `/object/sign/${r[1]}/${path}?token=${token}`, error: null };
    }));
  }
  if (req.method === "POST" && (r = m(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
    const { expiresIn } = JSON.parse((await body(req)).toString());
    const token = randomBytes(16).toString("hex");
    tokens.set(token, { bucket: r[1], path: r[2], kind: "read", exp: Date.now() + expiresIn * 1000 });
    return json(res, 200, { signedURL: `/object/sign/${r[1]}/${r[2]}?token=${token}` });
  }
  if (req.method === "GET" && (r = m(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
    const t = tokens.get(url.searchParams.get("token"));
    if (!t || t.kind !== "read" || t.exp < Date.now() || t.path !== r[2]) return json(res, 400, { error: "InvalidSignature" });
    return sendFile(res, r[1], r[2]);
  }
  if (req.method === "GET" && (r = m(/^\/object\/public\/([^/]+)\/(.+)$/))) {
    if (!PUBLIC_BUCKETS.has(r[1])) return json(res, 400, { error: "not public" });
    return sendFile(res, r[1], r[2]);
  }
  if (req.method === "GET" && (r = m(/^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/))) return sendFile(res, r[1], r[2]);
  if (req.method === "POST" && (r = m(/^\/object\/list\/([^/]+)$/))) {
    const { prefix, search } = JSON.parse((await body(req)).toString());
    const dir = join(ROOT, r[1], prefix || "");
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.endsWith(".type") && (!search || n.includes(search))) : [];
    return json(res, 200, names.map((name) => ({ name, id: name, metadata: { size: statSync(join(dir, name)).size } })));
  }
  if (req.method === "DELETE" && (r = m(/^\/object\/([^/]+)$/))) {
    const { prefixes } = JSON.parse((await body(req)).toString());
    for (const pth of prefixes) { rmSync(file(r[1], pth), { force: true }); rmSync(file(r[1], pth) + ".type", { force: true }); }
    return json(res, 200, prefixes.map((name) => ({ name })));
  }
  if ((req.method === "POST" || req.method === "PUT") && (r = m(/^\/object\/([^/]+)\/(.+)$/))) {
    const { data, type } = await fileFromBody(req, await body(req));
    save(r[1], r[2], data, type);
    return json(res, 200, { Key: `${r[1]}/${r[2]}`, Id: randomBytes(8).toString("hex") });
  }
  json(res, 404, { error: `mock storage: ${req.method} ${p} not implemented` });
}

http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/auth/v1/")) return forward(req, res, 9999, req.url.replace(/^\/auth\/v1/, ""));
  if (url.pathname.startsWith("/rest/v1/")) return forward(req, res, 3001, req.url.replace(/^\/rest\/v1/, ""));
  if (url.pathname.startsWith("/storage/v1/")) return storage(req, res, url).catch((e) => json(res, 500, { error: String(e) }));
  res.writeHead(404); res.end();
}).listen(54321, "127.0.0.1", () => console.log("gateway on :54321"));
