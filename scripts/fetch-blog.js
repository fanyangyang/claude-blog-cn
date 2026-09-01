const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const BASE_URL = 'https://claude.com/blog';
const CONTENT_DIR = path.join(__dirname, '..', 'content', 'en');
const META_FILE = path.join(__dirname, '..', 'content', 'index.json');

// Track which articles we've already fetched
let meta = { articles: [], lastFetched: null };
if (fs.existsSync(META_FILE)) {
  try {
    meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  } catch (e) { /* ignore */ }
}

const knownSlugs = new Set(meta.articles.map(a => a.slug));

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeBlogCN/1.0)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractArticles(html) {
  // Extract article cards from the blog listing page
  const articles = [];
  // Match heading, date, category, and href from the HTML
  const headingRegex = /fs-list-field="heading">([^<]+)</g;
  const dateRegex = /fs-list-field="date">([^<]+)</g;
  const categoryRegex = /fs-list-field="category"[^>]*>([^<]+)</g;
  const hrefRegex = /href="\/blog\/([^"]+)"/g;

  const headings = [...html.matchAll(headingRegex)].map(m => m[1].trim());
  const dates = [...html.matchAll(dateRegex)].map(m => m[1].trim());
  const categories = [...html.matchAll(categoryRegex)].map(m => m[1].trim());
  const slugs = [...html.matchAll(hrefRegex)].map(m => m[1]);

  // Deduplicate slugs (blog page has multiple refs per article)
  const uniqueSlugs = [...new Set(slugs)];

  const count = Math.min(headings.length, dates.length, uniqueSlugs.length);
  for (let i = 0; i < count; i++) {
    articles.push({
      slug: uniqueSlugs[i],
      title: headings[i].replace(/&amp;/g, '&').replace(/&#x27;/g, "'"),
      date: dates[i],
      category: categories[i] || 'General',
      url: `https://claude.com/blog/${uniqueSlugs[i]}`,
    });
  }
  return articles;
}

function extractArticleContent(html) {
  // Extract the article body from the rich text content div
  const bodyMatch = html.match(/<div data-readtime="content" class="u-rich-text-blog u-margin-trim w-richtext">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/);
  if (bodyMatch) {
    return bodyMatch[1];
  }
  // Fallback: try to get any w-richtext content
  const fallbackMatch = html.match(/<div[^>]*class="[^"]*u-rich-text-blog[^"]*w-richtext[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/);
  if (fallbackMatch) {
    // Extract the inner content
    const inner = fallbackMatch[0].match(/<div[^>]*w-richtext[^>]*>([\s\S]*)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/);
    if (inner) return inner[1];
  }
  return null;
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  return m ? m[1].replace(/ \| Claude by Anthropic$/, '').trim() : null;
}

function extractDate(html) {
  const m = html.match(/fs-list-field="date"[^>]*>([^<]+)</);
  return m ? m[1].trim() : null;
}

function extractCategory(html) {
  const m = html.match(/fs-list-field="category"[^>]*>([^<]+)</);
  return m ? m[1].trim() : null;
}

async function main() {
  console.log('Fetching blog listing...');
  const listingHtml = await fetch(BASE_URL);
  const articles = extractArticles(listingHtml);
  console.log(`Found ${articles.length} articles on blog page`);

  let newCount = 0;
  let updatedCount = 0;

  for (const article of articles) {
    const isNew = !knownSlugs.has(article.slug);
    const articleDir = path.join(CONTENT_DIR, article.slug);
    const htmlFile = path.join(articleDir, 'article.html');

    if (fs.existsSync(htmlFile) && !isNew) {
      continue; // Already fetched
    }

    console.log(`${isNew ? 'NEW' : 'UPDATE'}: ${article.slug} — ${article.title}`);

    // Fetch the full article page
    const articleHtml = await fetch(article.url);

    // Create directory
    fs.mkdirSync(articleDir, { recursive: true });

    // Save raw HTML
    fs.writeFileSync(htmlFile, articleHtml, 'utf-8');

    // Extract and save content
    const content = extractArticleContent(articleHtml);
    if (content) {
      fs.writeFileSync(path.join(articleDir, 'content.html'), content, 'utf-8');
    } else {
      console.warn(`  ⚠ Could not extract content for ${article.slug}`);
    }

    // Extract title from page
    const pageTitle = extractTitle(articleHtml);
    if (pageTitle) article.title = pageTitle;

    // Extract date from page
    const pageDate = extractDate(articleHtml);
    if (pageDate) article.date = pageDate;

    // Extract category from page
    const pageCategory = extractCategory(articleHtml);
    if (pageCategory) article.category = pageCategory;

    // Save metadata
    const articleMeta = {
      slug: article.slug,
      title: article.title,
      date: article.date,
      category: article.category,
      url: article.url,
      fetchedAt: new Date().toISOString(),
      translated: false,
    };
    fs.writeFileSync(path.join(articleDir, 'meta.json'), JSON.stringify(articleMeta, null, 2), 'utf-8');

    // Update index
    const existingIdx = meta.articles.findIndex(a => a.slug === article.slug);
    if (existingIdx >= 0) {
      meta.articles[existingIdx] = articleMeta;
      updatedCount++;
    } else {
      meta.articles.push(articleMeta);
      newCount++;
    }

    // Be nice to the server
    await new Promise(r => setTimeout(r, 1000));
  }

  // Sort articles by date descending
  meta.articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  meta.lastFetched = new Date().toISOString();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`\nDone! ${newCount} new, ${updatedCount} updated, ${meta.articles.length} total`);
  console.log(`Articles saved to ${CONTENT_DIR}`);
}

main().catch(console.error);