import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import cookieParser from 'cookie-parser';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;

const app = express();
const proxy = createProxyServer({});
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

function getCookiesForTarget(req, target) {
  const cookieJar = req.cookies || {};
  return Object.entries(cookieJar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function proxyRequest(target, reqOptions = {}, req, res) {
  try {
    const headers = reqOptions.headers || {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    const cookieHeader = getCookiesForTarget(req, target);
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const response = await fetch(target, {
      ...reqOptions,
      headers,
      redirect: 'manual'
    });

    const setCookie = response.headers.raw()['set-cookie'];
    if (setCookie) {
      setCookie.forEach(cookie => res.append('Set-Cookie', cookie));
    }

    return response;
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
    return null;
  }
}

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing "url" parameter');

  // Google Search fallback
  if (target.startsWith('https://www.google.com/search')) {
    const parsed = new URL(target);
    const query = parsed.searchParams.get('q') || '';
    const fallbackURL = `https://duckduckgo.com/?q=${query}`;
    return res.redirect(`/proxy?url=${encodeURIComponent(fallbackURL)}`);
  }

  const response = await proxyRequest(target, {}, req, res);
  if (!response) return;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const body = await response.text();
    const $ = cheerio.load(body);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const absoluteUrl = new URL(href, target).href;
        $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
      }
    });

    $('form[action]').each((_, el) => {
      const action = $(el).attr('action');
      if (action) {
        const absoluteAction = new URL(action, target).href;
        const urlOnly = absoluteAction.split('?')[0];
        const method = ($(el).attr('method') || 'get').toLowerCase();
        if (method === 'post') {
          $(el).attr('action', `/proxy/form-post?url=${encodeURIComponent(urlOnly)}`);
        } else {
          $(el).attr('action', `/proxy/form?url=${encodeURIComponent(urlOnly)}`);
        }
      }
    });

    res.set('Content-Type', 'text/html');
    return res.send($.html());
  } else {
    res.set('Content-Type', contentType);
    response.body.pipe(res);
  }
});

app.all('/proxy/form', async (req, res) => {
  const baseUrl = req.query.url;
  if (!baseUrl) return res.status(400).send('Missing "url" parameter');

  const fullUrl = new URL(baseUrl);
  const params = new URLSearchParams(req.query);
  params.delete('url');
  fullUrl.search = params.toString();
  return res.redirect(`/proxy?url=${encodeURIComponent(fullUrl.toString())}`);
});

app.post('/proxy/form-post', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing "url" parameter');

  const response = await proxyRequest(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(req.body).toString()
  }, req, res);
  if (!response) return;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const body = await response.text();
    const $ = cheerio.load(body);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const absoluteUrl = new URL(href, targetUrl).href;
        $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
      }
    });

    $('form[action]').each((_, el) => {
      const action = $(el).attr('action');
      if (action) {
        const absoluteAction = new URL(action, targetUrl).href;
        const urlOnly = absoluteAction.split('?')[0];
        const method = ($(el).attr('method') || 'get').toLowerCase();
        if (method === 'post') {
          $(el).attr('action', `/proxy/form-post?url=${encodeURIComponent(urlOnly)}`);
        } else {
          $(el).attr('action', `/proxy/form?url=${encodeURIComponent(urlOnly)}`);
        }
      }
    });

    res.set('Content-Type', 'text/html');
    return res.send($.html());
  } else {
    res.set('Content-Type', contentType);
    response.body.pipe(res);
  }
});

app.get('/download', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing "url" parameter');

  const response = await proxyRequest(target, {}, req, res);
  if (!response || !response.ok) return res.status(500).send('Failed to download file');

  const fileName = target.split('/').pop() || 'downloaded.file';
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');

  response.body.pipe(res);
});

app.get('/', (req, res) => {
  res.send(`
    <form action="/proxy" method="get">
      <input type="text" name="url" placeholder="Enter a URL" style="width: 300px;">
      <button type="submit">Go</button>
    </form>
    <p>Or download a file:</p>
    <form action="/download" method="get">
      <input type="text" name="url" placeholder="File URL" style="width: 300px;">
      <button type="submit">Download</button>
    </form>
  `);
});

app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
});
