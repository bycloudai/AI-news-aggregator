import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config for API keys
let config = {};
try {
  const configPath = join(__dirname, '..', 'config.json');
  const configData = await readFile(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (e) {
  console.log('No config.json found - LLM summarization disabled');
}

// AI-related keywords for filtering
const AI_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'ml', 'llm',
  'gpt', 'claude', 'gemini', 'llama', 'mistral', 'model', 'neural',
  'deep learning', 'transformer', 'chatbot', 'agent', 'reasoning',
  'multimodal', 'vision', 'language model', 'foundation model',
  'training', 'fine-tuning', 'benchmark', 'release', 'launch',
  'api', 'sdk', 'announcement', 'introducing', 'new'
];

/**
 * Check if text contains AI-related keywords
 */
function isAIRelated(text) {
  const lowerText = text.toLowerCase();
  return AI_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

/**
 * Call Gemini API to summarize content into one line
 */
async function summarizeWithLLM(title, content) {
  if (!config.gemini_api_key) {
    console.log('No Gemini API key - skipping summarization');
    return title;
  }
  
  try {
    const model = config.gemini_model || 'gemini-2.0-flash';
    
    // Truncate content to ~5000 tokens (roughly 20,000 chars) and ensure spaces
    const truncatedContent = content ? content.substring(0, 20000).replace(/\s+/g, ' ').trim() : '';
    const prompt = `Write a 6-10 word headline for this AI news article. Output ONLY the headline, nothing else. Note: The text may have formatting issues or concatenated words/names - please interpret and fix them correctly.\n\nTitle: ${title}\n\nContent: ${truncatedContent}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini_api_key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 40,
            temperature: 0.1
          }
        }),
        signal: controller.signal
      }
    );
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.error('Gemini API error:', response.status);
      return title;
    }
    
    const data = await response.json();
    let summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    // Clean and validate
    if (summary) {
      summary = summary
        .replace(/^["'`]|["'`]$/g, '')
        .replace(/^\.+|\.+$/g, '')
        .replace(/^Rewritten:\s*/i, '')
        .trim();
      
      // Validate: must be 3+ words and not too short
      const wordCount = summary.split(/\s+/).length;
      if (wordCount >= 3 && summary.length >= 15) {
        console.log(`✓ ${summary}`);
        return summary;
      }
    }
    
    return title;
  } catch (error) {
    console.error('LLM error:', error.message);
    return title;
  }
}

/**
 * Fetch article page to get publication date and content for summarization
 */
async function fetchArticleDetails(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    if (!response.ok) return { date: null, content: '' };
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract publication date
    let pubDate = null;
    
    // Try meta tags first (most reliable)
    const metaDateSelectors = [
      'meta[property="article:published_time"]',
      'meta[name="publishdate"]',
      'meta[name="publish-date"]',
      'meta[name="date"]',
      'meta[property="og:published_time"]',
      'meta[name="DC.date.issued"]',
      'meta[itemprop="datePublished"]'
    ];
    
    for (const selector of metaDateSelectors) {
      const content = $(selector).attr('content');
      if (content) {
        pubDate = parseDate(content);
        if (pubDate) break;
      }
    }
    
    // Try time elements and date classes
    if (!pubDate) {
      const dateSelectors = [
        'time[datetime]',
        '[itemprop="datePublished"]',
        '.publish-date',
        '.post-date',
        '.entry-date',
        '.article-date',
        '.date-published',
        '[class*="publish"][class*="date"]'
      ];
      
      for (const selector of dateSelectors) {
        const $el = $(selector).first();
        if ($el.length) {
          const datetime = $el.attr('datetime') || $el.attr('content') || $el.text().trim();
          pubDate = parseDate(datetime);
          if (pubDate) break;
        }
      }
    }
    
    // Try JSON-LD structured data
    if (!pubDate) {
      $('script[type="application/ld+json"]').each((i, el) => {
        if (pubDate) return false;
        try {
          const json = JSON.parse($(el).html());
          const dateStr = json.datePublished || json.publishedDate || 
                         (json['@graph'] && json['@graph'].find(g => g.datePublished)?.datePublished);
          if (dateStr) {
            pubDate = parseDate(dateStr);
          }
        } catch (e) {}
      });
    }
    
    // Extract article content for summarization
    let content = '';
    
    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .comments, .related, .sidebar').remove();
    
    // Try common article content selectors
    const contentSelectors = [
      'article',
      '[itemprop="articleBody"]',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.article-body',
      '.content-body',
      'main'
    ];
    
    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      if ($content.length) {
        content = $content.text().replace(/\s+/g, ' ').trim();
        if (content.length > 200) break;
      }
    }
    
    // Fallback to body text
    if (content.length < 200) {
      content = $('body').text().replace(/\s+/g, ' ').trim();
    }
    
    return { date: pubDate, content: content.substring(0, 5000) };
  } catch (error) {
    console.error(`Error fetching article ${url}:`, error.message);
    return { date: null, content: '' };
  }
}

/**
 * Parse various date formats into a Date object
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Try native Date parsing first
  let date = new Date(dateStr);
  if (!isNaN(date.getTime()) && date.getFullYear() > 2000) {
    return date;
  }
  
  // Common formats: "January 15, 2024", "Jan 15, 2024", "15 Jan 2024"
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ];
  
  const cleanStr = dateStr.toLowerCase().trim();
  
  // Match "Month DD, YYYY" or "DD Month YYYY"
  for (let i = 0; i < monthNames.length; i++) {
    const month = monthNames[i];
    const monthNum = i % 12;
    
    // "January 15, 2024" or "January 15 2024"
    const match1 = cleanStr.match(new RegExp(`${month}\\s+(\\d{1,2})[,\\s]+(\\d{4})`));
    if (match1) {
      return new Date(parseInt(match1[2]), monthNum, parseInt(match1[1]));
    }
    
    // "15 January 2024"
    const match2 = cleanStr.match(new RegExp(`(\\d{1,2})\\s+${month}[,\\s]+(\\d{4})`));
    if (match2) {
      return new Date(parseInt(match2[2]), monthNum, parseInt(match2[1]));
    }
  }
  
  // Match "YYYY-MM-DD" or "YYYY/MM/DD"
  const isoMatch = cleanStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }
  
  // Match "MM/DD/YYYY" or "DD/MM/YYYY" (assume MM/DD/YYYY for US sites)
  const usMatch = cleanStr.match(/(\d{1,2})[\/](\d{1,2})[\/](\d{4})/);
  if (usMatch) {
    return new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
  }
  
  return null;
}

/**
 * Fetch news from a blog URL
 */
async function fetchBlogNews(source) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch ${source.name}: ${response.status}`);
      return [];
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    const news = [];
    
    // Generic selectors that work for most blogs
    const selectors = [
      'article h2 a',
      'article h3 a',
      '.post-title a',
      '.entry-title a',
      '.article-title a',
      'h2.title a',
      'h3.title a',
      '.blog-post h2 a',
      '.blog-post h3 a',
      'a[href*="/blog/"]',
      'a[href*="/news/"]',
      'a[href*="/article/"]',
      '.card-title a',
      '.news-item a',
      'h2 a',
      'h3 a'
    ];
    
    // Date selectors to find publication dates
    const dateSelectors = [
      'time',
      '[datetime]',
      '.date',
      '.post-date',
      '.entry-date',
      '.published',
      '.publish-date',
      '.article-date',
      '.meta-date',
      '[class*="date"]',
      '[class*="time"]'
    ];
    
    const seenUrls = new Set();
    
    for (const selector of selectors) {
      $(selector).each((i, el) => {
        if (news.length >= 10) return false; // Limit per source
        
        const $el = $(el);
        let title = $el.text().trim();
        
        // Clean up title - remove dates, category labels, extra whitespace
        title = title
          .replace(/\s+/g, ' ')  // normalize whitespace
          .replace(/(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}/gi, '') // remove dates
          .replace(/\d{4}-\d{2}-\d{2}/g, '') // remove ISO dates
          .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '') // remove MM/DD/YYYY
          .replace(/(Research|Product|Announcements?|News|Blog|NEW|Text|Speech|Video|Music|API)/gi, ' ') // remove category labels
          .replace(/Mistral\s*AI/gi, '') // remove company names from middle of title
          .replace(/\s+/g, ' ')  // normalize whitespace again
          .replace(/^\s*[-–—|:]\s*/, '') // remove leading dashes/colons
          .trim();
        
        let url = $el.attr('href');
        
        if (!title || !url || seenUrls.has(url)) return;
        
        // Make relative URLs absolute
        if (url.startsWith('/')) {
          const baseUrl = new URL(source.url);
          url = `${baseUrl.origin}${url}`;
        }
        
        // Skip if not AI related (for generic blogs)
        if (title.length < 10 || title.length > 200) return;
        
        // Try to find publication date near this element
        let pubDate = null;
        const $parent = $el.closest('article, .post, .entry, .card, .news-item, li, div');
        
        if ($parent.length) {
          // Look for date within the parent container
          for (const dateSelector of dateSelectors) {
            const $dateEl = $parent.find(dateSelector).first();
            if ($dateEl.length) {
              // Try datetime attribute first
              const datetime = $dateEl.attr('datetime');
              if (datetime) {
                pubDate = parseDate(datetime);
                if (pubDate) break;
              }
              // Try text content
              const dateText = $dateEl.text().trim();
              pubDate = parseDate(dateText);
              if (pubDate) break;
            }
          }
        }
        
        // Try to extract date from URL (common pattern: /2024/01/15/ or /2024-01-15)
        if (!pubDate) {
          const urlDateMatch = url.match(/\/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
          if (urlDateMatch) {
            pubDate = new Date(urlDateMatch[1], urlDateMatch[2] - 1, urlDateMatch[3]);
          }
        }
        
        seenUrls.add(url);
        
        news.push({
          id: `${source.id}-${Date.now()}-${i}`,
          originalTitle: title,
          title: title, // Will be replaced with summary
          url: url,
          source: source.name,
          sourceType: 'blog',
          date: pubDate ? pubDate.toISOString() : null,
          isAIRelated: isAIRelated(title)
        });
      });
      
      if (news.length >= 5) break;
    }
    
    // Filter to AI-related news only
    let filteredNews = news.filter(n => n.isAIRelated).slice(0, 5);
    
    // Fetch article details for dates and summarize titles
    for (const item of filteredNews) {
      // Fetch article page for date and content
      let articleContent = '';
      try {
        const details = await fetchArticleDetails(item.url);
        if (details.date) {
          item.date = details.date.toISOString();
        }
        articleContent = details.content || '';
      } catch (e) {
        console.log(`Could not fetch article: ${item.url}`);
      }
      
      // Summarize with LLM using title + content
      if (config.gemini_api_key) {
        const inputPreview = `${item.originalTitle} ${articleContent}`.substring(0, 200);
        console.log(`[SUMMARIZE] ${inputPreview}...`);
        item.title = await summarizeWithLLM(item.originalTitle, articleContent);
        console.log(`[DONE] => ${item.title}`);
      } else {
        item.title = item.originalTitle;
      }
    }
    
    return filteredNews;
  } catch (error) {
    console.error(`Error fetching ${source.name}:`, error.message);
    return [];
  }
}

/**
 * Parse RSS XML feed
 */
function parseRSSFeed(xml, source) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const news = [];
  
  // Handle both RSS and Atom formats
  const items = $('item').length > 0 ? $('item') : $('entry');
  
  items.each((i, el) => {
    if (news.length >= 5) return false;
    
    const $item = $(el);
    
    // RSS format
    let title = $item.find('title').text().trim();
    let link = $item.find('link').text().trim() || $item.find('link').attr('href');
    let pubDate = $item.find('pubDate').text() || $item.find('published').text();
    let description = $item.find('description').text().trim() || $item.find('content').text().trim();
    
    // Clean up title (remove CDATA if present)
    title = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    
    // For Twitter RSS feeds, the title is often the tweet content
    const displayTitle = title.length > 150 ? title.substring(0, 150) + '...' : title;
    
    if (displayTitle && isAIRelated(displayTitle + ' ' + description)) {
      news.push({
        id: `${source.id}-${Date.now()}-${i}`,
        title: displayTitle,
        url: link || source.url,
        source: source.name,
        sourceType: 'twitter',
        handle: source.handle,
        date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  });
  
  return news;
}

/**
 * Fetch news from Twitter/X via RSS feed (using RSS.app or similar service)
 * 
 * To get RSS feeds for Twitter accounts:
 * 1. Go to https://rss.app/rss-feed/create-twitter-rss-feed
 * 2. Enter the Twitter URL (e.g., https://twitter.com/OpenAI)
 * 3. Copy the generated RSS feed URL
 * 4. Add it to sources.json
 */
async function fetchTwitterNews(source) {
  // Skip placeholder URLs
  if (source.url === 'PLACEHOLDER_RSS_URL' || source.url === 'PLACEHOLDER_URL' || !source.url) {
    return [];
  }
  
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch RSS for ${source.name}: ${response.status}`);
      return [];
    }
    
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    
    // Check if it's an RSS/XML feed
    if (contentType.includes('xml') || text.trim().startsWith('<?xml') || text.includes('<rss') || text.includes('<feed')) {
      return parseRSSFeed(text, source);
    }
    
    // Fallback: try parsing as HTML (for Nitter-like services)
    const $ = cheerio.load(text);
    const news = [];
    
    $('.tweet-content, .tweet-text, [data-testid="tweetText"]').each((i, el) => {
      if (news.length >= 5) return false;
      
      const tweetText = $(el).text().trim();
      if (tweetText && isAIRelated(tweetText)) {
        news.push({
          id: `${source.id}-${Date.now()}-${i}`,
          title: tweetText.substring(0, 150) + (tweetText.length > 150 ? '...' : ''),
          url: source.url,
          source: source.name,
          sourceType: 'twitter',
          handle: source.handle,
          date: new Date().toISOString()
        });
      }
    });
    
    return news;
  } catch (error) {
    console.error(`Error fetching Twitter ${source.name}:`, error.message);
    return [];
  }
}

/**
 * Fetch news from all enabled sources
 */
export async function fetchAllNews(sources) {
  const allNews = [];
  
  // Fetch from blogs
  const enabledBlogs = sources.blogs.filter(s => s.enabled);
  for (const blog of enabledBlogs) {
    const news = await fetchBlogNews(blog);
    allNews.push(...news);
  }
  
  // Fetch from Twitter
  const enabledTwitter = sources.twitter.filter(s => s.enabled);
  for (const twitter of enabledTwitter) {
    const news = await fetchTwitterNews(twitter);
    allNews.push(...news);
  }
  
  // Sort by date (newest first) and dedupe
  const seenTitles = new Set();
  return allNews
    .filter(item => {
      const titleKey = item.title.toLowerCase().substring(0, 50);
      if (seenTitles.has(titleKey)) return false;
      seenTitles.add(titleKey);
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
