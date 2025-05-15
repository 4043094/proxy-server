import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;

const app = express();
const proxy = createProxyServer({});
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Redirect Google searches to DuckDuckGo
app.get('/proxy', async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).send('Missing "url" parameter');
  }

  // Fallback to DuckDuckGo if targeting Google Search
  if (target.startsWith('https://www.google.com/search')) {
    const parsed = new URL(target);
    const query = parsed.searchParams.get('q') || '';
    const fallbackURL = `https://duckduckgo.com/?q=${query}`;
    const finalURL = `/proxy?url=${encodeURIComponent(fallbackURL)}`;
    return res.redirect(finalURL);
  }

  try {
    const response = await fetch(target);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const body = await response.text();
      const $ = cheerio.load(body);

      // Rewrite links
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          const absoluteUrl = new URL(href, target).href;
          $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
        }
      });

      // Rewrite forms to proxy/form route
      $('form[action]').each((_, el) => {
        const action = $(el).attr('action');
        if (action) {
          const absoluteAction = new URL(action, target).href;
          const urlOnly = absoluteAction.split('?')[0]; // remove query params
          $(el).attr('action', `/proxy/form?url=${encodeURIComponent(urlOnly)}`);
          $(el).attr('method', 'GET');
        }
      });

      res.set('Content-Type', 'text/html');
      return res.send($.html());
    } else {
      // For non-HTML (e.g., files), stream directly
      res.set('Content-Type', contentType);
      response.body.pipe(res);
    }
  } catch (err) {
    res.status(500).send('Error fetching the target URL: ' + err.message);
  }
});

// Support rewritten form submissions via /proxy/form
app.all('/proxy/form', async (req, res) => {
  const baseUrl = req.query.url;
  if (!baseUrl) return res.status(400).send('Missing "url" parameter');

  const fullUrl = new URL(baseUrl);
  const params = new URLSearchParams(req.query);

  // Remove 'url' so it's not passed to the target
  params.delete('url');

  fullUrl.search = params.toString();

  return res.redirect(`/proxy?url=${encodeURIComponent(fullUrl.toString())}`);
});

// File download support
app.get('/download', async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).send('Missing "url" parameter');
  }

  try {
    const response = await fetch(target);
    if (!response.ok) {
      return res.status(500).send('Failed to download file');
    }

    const fileName = target.split('/').pop() || 'downloaded.file';
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');

    response.body.pipe(res);
  } catch (err) {
    res.status(500).send('Download error: ' + err.message);
  }
});

// Homepage UI
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

// Start server
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
});
