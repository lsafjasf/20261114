import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, safePath === "/" ? "index.html" : safePath);

  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`Tide Line running at http://localhost:${port}`);
});
