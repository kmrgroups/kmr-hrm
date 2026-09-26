// Stand-in for www.kmr-groups.com: its own pages, plus the rewrite that sends /it/hrm/* to the HRM app
// (the same thing the Vercel rewrite in the KMR project does). Like a Vercel external rewrite,
// the Host header seen by the HRM app is the HRM deployment's own host.
import http from "node:http";
const HRM = { host: "127.0.0.1", port: 3000 };
http.createServer((req, res) => {
  if (req.url === "/it/hrm.html") { res.writeHead(308, { Location: "/it/hrm" }); return res.end(); }
  if (req.url === "/it/hrm" || req.url.startsWith("/it/hrm/") || req.url.startsWith("/it/hrm?")) {
    const p = http.request({ ...HRM, path: req.url, method: req.method, headers: { ...req.headers, host: "localhost:3000" } }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    return req.pipe(p);
  }
  // the host site's own cookie with the same name Supabase would use — must not interfere
  res.writeHead(200, { "content-type": "text/html", "set-cookie": "sb-127-auth-token=kmr-site-session; Path=/" });
  res.end("<h1>KMR Group of Companies</h1><a href='/it/hrm'>HRM</a>");
}).listen(8080, "127.0.0.1", () => console.log("host site on :8080"));
