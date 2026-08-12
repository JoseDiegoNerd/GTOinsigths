import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = 'public';
const hosts = ['127.0.0.1', 'localhost'];
const ports = [5173, 3000];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const securityHeaders = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Este servidor serve public/index.html direto - o mesmo arquivo publicado em producao (ver
  // netlify.toml), que tem todo o JS num <script type="module"> inline importando do esm.sh.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://ysreenjwihmwzockyrls.supabase.co; " +
    "connect-src 'self' https://ysreenjwihmwzockyrls.supabase.co wss://ysreenjwihmwzockyrls.supabase.co; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

function resolvePath(url) {
  const clean = decodeURIComponent((url ?? '/').split('?')[0]);
  const relative = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const file = normalize(join(root, relative));
  return file.startsWith(normalize(root)) ? file : join(root, 'index.html');
}

function requestHandler(req, res) {
  let file = resolvePath(req.url);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...securityHeaders
  });
  res.end(readFileSync(file));
}

for (const port of ports) {
  createServer(requestHandler).listen(port, '0.0.0.0', () => {
    console.log(`GTO Insights local app:`);
    for (const host of hosts) {
      console.log(`- http://${host}:${port}/`);
    }
  });
}
