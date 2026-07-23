import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = 'dist';
const port = Number(process.env.PORT ?? 5173);
const host = '127.0.0.1';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function resolvePath(url) {
  const cleanUrl = decodeURIComponent(url.split('?')[0] ?? '/');
  const relative = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
  const fullPath = normalize(join(root, relative));
  return fullPath.startsWith(normalize(root)) ? fullPath : join(root, 'index.html');
}

const server = createServer((req, res) => {
  let filePath = resolvePath(req.url ?? '/');

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html');
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypes[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  res.end(readFileSync(filePath));
});

server.listen(port, host, () => {
  console.log(`GTO Insights local app: http://${host}:${port}/`);
});
