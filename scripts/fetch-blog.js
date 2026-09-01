const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const BASE_URL = 'https://claude.com/blog';
const CONTENT_DIR = path.join(__dirname, '..', 'content', 'en');
const META_FILE = path.join(__dirname, '..', 'content', 'index.json');

// Track which articles we've already fetched
let meta = { articles: [], lastFetched: null };
if (fs.existsSync(META_FILE)) {
  try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8')); } catch (e) {}
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
  const $ = cheerio.load(html);
  const articles = [];

  // Each blog card is a w-dyn-item
  $('.w-dyn-item').each((i, el) => {
    const $el = $(el);

    // Title from fs-list-field="heading"
    const title = $el.find('[fs-list-field="heading"]').first().text().trim();
    // Date from fs-list-field="date"
    const date = $el.find('[fs-list-field="date"]').first().text().trim();
    // Category from fs-list-field="category"
    let category = $el.find('[fs-list-field="category"]').first().text().trim();
    if (!category) category = 'General';
    // Slug from href
    const href = $el.find('a[href^="/blog/"]').first().attr('href') || '';
    const slug = href.replace('/blog/', '');

    if (slug && title) {
      articles.push({
        slug,
        title: title.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&#x2019;/g, "'"),
        date,
        category,
        url: `https://claude.com/blog/${slug}`,
      });
    }
  });

  return articles;
}

function extractArticleContent(html) {
  const $ = cheerio.load(html);

  // The main content div: data-readtime="content" with class w-richtext
  // First try the exact match
  const contentDiv = $('div[data-readtime="content"].w-richtext').first();
  if (contentDiv.length && contentDiv.text().trim().length > 0) {
    return $.html(contentDiv);
  }

  // Fallback: try any w-richtext inside the blog post section
  const blogSection = $('section.blog_post_section_wrap').first();
  if (blogSection.length) {
    const richtext = blogSection.find('.w-richtext.u-rich-text-blog').first();
    if (richtext.length && richtext.text().trim().length > 100) {
      return $.html(richtext);
    }
  }

  // Last resort: any w-richtext with substantial content (not nav/footer)
  $('.w-richtext').each((i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    // Skip if too short, or if it's in header/footer
    if (text.length > 500 && !$el.closest('header').length && !$el.closest('footer').length) {
      return $.html($el);
    }
  });

  return null;
}

function extractMeta(html) {
  const $ = cheerio.load(html);
  const title = $('title').text().replace(/ \| Claude by Anthropic$/, '').trim();
  const date = $('[fs-list-field="date"]').first().text().trim() || null;
  const category = $('[fs-list-field="category"]').first().text().trim() || 'General';
  return { title, date, category };
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
      console.log(`  ✓ content saved (${content.length} bytes)`);
    } else {
      console.warn(`  ⚠ Could not extract content for ${article.slug}`);
    }

    // Extract meta from page
    const pageMeta = extractMeta(articleHtml);
    if (pageMeta.title) article.title = pageMeta.title;
    if (pageMeta.date) article.date = pageMeta.date;
    if (pageMeta.category) article.category = pageMeta.category;

    // Save article metadata
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

    // Mark as known so we don't refetch in this run
    knownSlugs.add(article.slug);

    // Be nice to the server
    await new Promise(r => setTimeout(r, 1500));
  }

  // Sort by date descending
  meta.articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  meta.lastFetched = new Date().toISOString();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`\nDone! ${newCount} new, ${updatedCount} updated, ${meta.articles.length} total`);
}

main().catch(console.error);