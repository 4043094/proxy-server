import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { createProxyServer } from 'http-proxy';
import { pipeline } from 'stream';
import { createServer } from 'http';
import { URL } from 'url';

const app = express();
const proxy = createProxyServer({ changeOrigin: true });

function rewriteHTML(html, baseUrl, proxyBase) {
  const $ = cheerio.load(html);

  $('a[href], link[href], script[src], img[src], iframe[src]').each((_, el) => {
    const attr = el.name === 'a' || el.name === 'link' ? 'href' : 'src';
    const original = $(el).attr(attr);
    if (!original || original.startsWith('data:') || original.startsWith('mailto:')) return;

    try {
      const absolute = new URL(original, baseUrl).href;
      $(el).attr(attr, `${proxyBase}?url=${encodeURIComponent(absolute)}`);
    } catch {}
  });

  return $.html();
}

app.get('/', (req, res) => {
  res.send(`
    <form method="GET" action="/proxy">
      <input name="url" placeholder="https://example.com" size="50" required>
      <button type="submit">Visit</button>
    </form>
    <p>Example: Try https://example.com or https://www.gnu.org/licenses/gpl-3.0.txt</p>
  `);
});

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target || !/^https?:\/\//.test(target)) {
    return res.status(400).send('Invalid or missing URL.');
  }

  try {
    const response = await fetch(target);
    const contentType = response.headers.get('content-type');

    res.set('X-Proxied-By', 'Rewriting Proxy');

    if (contentType && contentType.includes('text/html')) {
      const body = await response.text();
      const rewritten = rewriteHTML(body, target, '/proxy');
      res.set('Content-Type', 'text/html');
      return res.send(rewritten);
    }

    // Non-HTML (e.g., images, CSS)
    res.set('Content-Type', contentType || 'application/octet-stream');
    pipeline(response.body, res, (err) => {
      if (err) res.status(500).end('Stream error');
    });

  } catch (err) {
    res.status(500).send(`Fetch failed: ${err.message}`);
  }
});

// Programmatic download
app.get('/download', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).send('Invalid URL.');
  }

  try {
    const response = await fetch(url);
    const contentDisposition = response.headers.get('content-disposition');
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', contentDisposition || 'attachment; filename=file');

    pipeline(response.body, res, (err) => {
      if (err) res.status(500).send('Download failed.');
    });
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 8080;
createServer(app).listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
