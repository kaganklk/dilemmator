// server.js — Local Vercel Serverless ve Statik Dosya Emülatörü (Yalnızca Local Test İçindir)
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Her istek geldiğinde .env dosyasını yeniden okuyup güncel tutalım (Sunucu aç kapat yapmadan şifre eklenebilsin!)
function reloadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const cleanLine = line.trim();
      if (cleanLine && !cleanLine.startsWith('#')) {
        const parts = cleanLine.split('=');
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        if (key) {
          process.env[key] = val;
        }
      }
    });
  }
}
reloadEnv();

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  reloadEnv(); // Her API veya sayfa çağrısında .env şifresi eklenmiş mi diye anlık kontrol et!
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  // --- Vercel Serverless API Yönlendirmesi (/api/*) ---
  if (pathname.startsWith('/api/')) {
    const apiName = pathname.replace('/api/', '').replace(/\.js$/, '');
    const apiFilePath = path.join(__dirname, 'api', `${apiName}.js`);

    if (!fs.existsSync(apiFilePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: `API endpoint bulunamadı: /api/${apiName}` }));
    }

    res.status = function(code) {
      res.statusCode = code;
      return res;
    };
    res.json = function(data) {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(data));
      return res;
    };

    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        req.body = bodyData ? JSON.parse(bodyData) : {};
      } catch {
        req.body = {};
      }

      try {
        const module = await import(`file://${apiFilePath}?t=${Date.now()}`);
        const handler = module.default;
        if (typeof handler === 'function') {
          await handler(req, res);
        } else {
          res.status(500).json({ error: 'Handler bir fonksiyon değil.' });
        }
      } catch (err) {
        console.error(`❌ Local API Hatası (${pathname}):`, err);
        res.status(500).json({ error: 'Local serverless yürütücü hatası', message: err.message });
      }
    });
    return;
  }

  // --- Statik Dosya Yönlendirmesi (public klasörü) ---
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(__dirname, 'public', pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Dosya Bulunamadı (Dilemmator Local Dev)');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ Local Vercel Emülatör Sunucusu Canlandı: http://localhost:${PORT}`);
  console.log(`🎮 Oyunu lokalde test etmeye hazırsınız!\n`);
});
