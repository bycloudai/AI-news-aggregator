import express from 'express';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchAllNews } from './services/scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Data file paths
const SOURCES_FILE = join(__dirname, 'data', 'sources.json');
const NEWS_CACHE_FILE = join(__dirname, 'data', 'news-cache.json');

// Helper functions
async function readJSON(filePath) {
  const data = await readFile(filePath, 'utf-8');
  return JSON.parse(data);
}

async function writeJSON(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

// ============ NEWS ROUTES ============

// Get all cached news
app.get('/api/news', async (req, res) => {
  try {
    const cache = await readJSON(NEWS_CACHE_FILE);
    res.json(cache);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Refresh news from all sources
app.post('/api/news/refresh', async (req, res) => {
  try {
    const sources = await readJSON(SOURCES_FILE);
    const news = await fetchAllNews(sources);

    // Use current timestamp for any items without a date so they appear latest
    const nowIso = new Date().toISOString();
    const normalized = news.map(n => ({ ...n, date: n.date || nowIso }));
    
    // Sort by date (newest first)
    const sortedNews = normalized.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    const cache = {
      lastUpdated: nowIso,
      news: sortedNews
    };
    
    await writeJSON(NEWS_CACHE_FILE, cache);
    res.json(cache);
  } catch (error) {
    console.error('Error refreshing news:', error);
    res.status(500).json({ error: 'Failed to refresh news' });
  }
});

// ============ SOURCES ROUTES ============

// Get all sources
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await readJSON(SOURCES_FILE);
    res.json(sources);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

// Add a new source
app.post('/api/sources', async (req, res) => {
  try {
    const { type, name, url, handle } = req.body;
    
    if (!type || !name || !url) {
      return res.status(400).json({ error: 'Missing required fields: type, name, url' });
    }
    
    const sources = await readJSON(SOURCES_FILE);
    const id = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    
    const newSource = {
      id,
      name,
      url,
      enabled: true,
      type: type === 'twitter' ? 'twitter' : 'blog'
    };
    
    if (type === 'twitter' && handle) {
      newSource.handle = handle;
    }
    
    if (type === 'twitter') {
      sources.twitter.push(newSource);
    } else {
      sources.blogs.push(newSource);
    }
    
    await writeJSON(SOURCES_FILE, sources);
    res.json({ success: true, source: newSource });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add source' });
  }
});

// Update a source (enable/disable)
app.patch('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    
    const sources = await readJSON(SOURCES_FILE);
    
    // Search in both blogs and twitter
    let found = false;
    for (const source of sources.blogs) {
      if (source.id === id) {
        source.enabled = enabled;
        found = true;
        break;
      }
    }
    
    if (!found) {
      for (const source of sources.twitter) {
        if (source.id === id) {
          source.enabled = enabled;
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      return res.status(404).json({ error: 'Source not found' });
    }
    
    await writeJSON(SOURCES_FILE, sources);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update source' });
  }
});

// Delete a source
app.delete('/api/sources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sources = await readJSON(SOURCES_FILE);
    
    const blogIndex = sources.blogs.findIndex(s => s.id === id);
    if (blogIndex !== -1) {
      sources.blogs.splice(blogIndex, 1);
      await writeJSON(SOURCES_FILE, sources);
      return res.json({ success: true });
    }
    
    const twitterIndex = sources.twitter.findIndex(s => s.id === id);
    if (twitterIndex !== -1) {
      sources.twitter.splice(twitterIndex, 1);
      await writeJSON(SOURCES_FILE, sources);
      return res.json({ success: true });
    }
    
    res.status(404).json({ error: 'Source not found' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete source' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`AI News Aggregator running at http://localhost:${PORT}`);
});
