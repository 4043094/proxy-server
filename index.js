import express from 'express';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;

const app = express();
const proxy = createProxyServer({});
const PORT = process.env.PORT || 8080;

// Proxy fallback for Google Search
app.get('/proxy', async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).send('Missing "url" parameter');
  }

  // Fallback redirect to DuckDuckGo
  if (target.startsWith('https://www.google.com/search')) {
    const parsed = new URL(target);
    const query = parsed.searchParams.get('q') || '';
  
    const fallbackURL = `https://duckduckgo.com/?q=${query}`;
    const finalURL = `/proxy?url=${encodeURIComponent(fallbackURL)}`;
    console.log("Redirecting Google Search to:", finalURL);
  
    return res.redirect(finalURL);
  }  

  try {
    const response = await fetch(target);
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
          $(el).attr('action', `/proxy?url=${encodeURIComponent(absoluteAction)}`);
        }
      });

      res.set('Content-Type', 'text/html');
      return res.send($.html());
    } else {
      // Stream non-HTML content directly
      res.set('Content-Type', contentType);
      response.body.pipe(res);
    }
  } catch (err) {
    res.status(500).send('Error fetching the target URL: ' + err.message);
  }
});

// Download support
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

// Simple form UI at root
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
