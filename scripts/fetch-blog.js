const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const BASE_URL = 'https://claude.com/blog';
const CONTENT_DIR = path.join(__dirname, '..', 'content', 'en');
const META_FILE = path.join(__dirname, '..', 'content', 'index.json');
const ILLUSTRATION_DIR = path.join(__dirname, '..', 'assets', 'illustrations');

const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;
const RETRY_DELAYS_MS = [2000, 4000, 8000];
const USER_AGENT = 'Mozilla/5.0 (compatible; ClaudeBlogCN/1.0)';

// Concurrency for pagination pages and illustration downloads.
const PAGE_CONCURRENCY = 6;
const ILLO_CONCURRENCY = 6;
// Safety cap: never walk more than 20 listing pages.
const MAX_PAGES = 20;

const MONTHS_SHORT_TO_LONG = {
  Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June',
  Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run `worker(item)` over `items` with at most `limit` in flight.
// Workers must not rely on execution order; merging into shared maps is safe
// as long as the merge itself is synchronous (no await inside it).
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner);
  await Promise.all(runners);
  return results;
}

// Perform a single HTTP request. Resolves { statusCode, headers, body } where
// body is a string (text) or Buffer (binary). Rejects on network errors.
function requestOnce(url, binary) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: binary ? '*/*' : 'text/html,application/xhtml+xml',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf-8');
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    });
    req.on('error', reject);
  });
}

// Run an async operation with up to 3 retries and 2s/4s/8s backoff.
// Throws the last error when retries are exhausted.
async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.warn(`  ⚠ ${label} failed (attempt ${attempt}/${RETRY_DELAYS_MS.length + 1}), retrying in ${delay / 1000}s: ${lastError.message}`);
      await sleep(delay);
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${label} failed after ${RETRY_DELAYS_MS.length} retries: ${lastError.message}`);
}

// Robust fetch: validates HTTP 200, follows 301/302 redirects (max 5),
// retries transient failures 3 times with backoff, throws on exhaustion so
// error pages are never treated as content.
async function fetch(url, { binary = false } = {}) {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const { statusCode, headers, body } = await withRetry(
      () => requestOnce(current, binary),
      `GET ${current}`
    );
    if ([301, 302, 303, 307, 308].includes(statusCode)) {
      const location = headers.location;
      if (!location) {
        throw new Error(`Redirect (HTTP ${statusCode}) without Location header from ${current}`);
      }
      current = new URL(location, current).href;
      continue;
    }
    if (statusCode !== 200) {
      throw new Error(`HTTP ${statusCode} for ${current}`);
    }
    return body;
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}) for ${url}`);
}

function slugFromHref(href) {
  if (!href) return '';
  return href.replace(/^\/blog\//, '').split(/[?#]/)[0].replace(/\/$/, '');
}

// Normalize a date string to the long format used by the official site,
// e.g. "Aug 28, 2026" -> "August 28, 2026". Already-long strings pass through.
function toLongDate(value) {
  const s = (value || '').trim();
  if (!s) return '';
  const shortMatch = s.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})$/);
  if (shortMatch) {
    const long = MONTHS_SHORT_TO_LONG[shortMatch[1]];
    if (long) return `${long} ${Number(shortMatch[2])}, ${shortMatch[3]}`;
  }
  return s;
}

// Extract articles from the main grid. Only real cards are trusted:
// <div role="listitem" class="blog_cms_item w-dyn-item">. Filter checkboxes
// elsewhere on the page also use w-dyn-item, so a generic scan is not safe.
// Each grid article also appears once more in a hidden (u-display-none)
// metadata block carrying fs-list-field heading/date; cards are merged by
// slug, preferring the entry that has an illustration.
function extractGridArticles($) {
  const bySlug = new Map();
  $('div[role="listitem"].blog_cms_item.w-dyn-item').each((i, el) => {
    const $card = $(el);
    const slug = slugFromHref($card.find('a[href^="/blog/"]').first().attr('href'));
    if (!slug) return;

    const card = {
      slug,
      title: $card.find('.card_blog_title').first().text().trim()
        || $card.find('[fs-list-field="heading"]').first().text().trim(),
      // fs-list-field="date" is the long format ("August 28, 2026"); the
      // visible caption is short format ("Aug 28, 2026") and only a fallback.
      date: toLongDate(
        $card.find('[fs-list-field="date"]').first().text().trim()
        || $card.find('.u-text-style-caption.u-foreground-tertiary').first().text().trim()
      ),
      category: $card.find('[fs-list-field="category"]').first().text().trim(),
      illustrationUrl: $card.find('img.card_blog_illo').first().attr('src') || '',
      illustrationBg: $card.find('[data-illustration-bg]').first().attr('data-illustration-bg') || '',
      inGrid: true,
    };

    const existing = bySlug.get(slug);
    if (!existing || (!existing.illustrationUrl && card.illustrationUrl)) {
      bySlug.set(slug, card);
    }
  });
  return bySlug;
}

// Discover the Webflow CMS pagination of the main grid. The listing renders
// the same collection twice (grid view + list view), each with its own
// pagination wrapper and its own hash-prefixed page param
// ("?<hash>_page=N"). The grid view's wrapper is the one whose previous
// sibling is the .blog_cms_grid items container. The hash changes over time,
// so it must be extracted dynamically from the "View more" link. Returns
// { pageParam, totalPages } or null when there is no pagination at all.
function extractPagination($) {
  let nextHref = '';
  let totalPages = 0;

  const readPageCount = ($wrapper) => {
    const label = $wrapper.find('.w-page-count').first().attr('aria-label') || '';
    const match = label.match(/Page\s+\d+\s+of\s+(\d+)/);
    if (match) totalPages = Math.max(totalPages, Number(match[1]));
  };

  $('div.w-pagination-wrapper').each((i, wrapper) => {
    const $wrapper = $(wrapper);
    if (nextHref) return;
    if ($wrapper.prev().hasClass('blog_cms_grid')) {
      nextHref = $wrapper.find('a.w-pagination-next').first().attr('href') || '';
      readPageCount($wrapper);
    }
  });

  // Fallbacks: any "next" link, and any page-count element on the page.
  if (!nextHref) {
    nextHref = $('a.w-pagination-next').first().attr('href') || '';
  }
  if (!totalPages) {
    $('.w-page-count').each((i, el) => readPageCount($(el).closest('.w-pagination-wrapper').length ? $(el).closest('.w-pagination-wrapper') : $(el)));
  }

  const hashMatch = nextHref.match(/\?([a-f0-9]+)_page=/);
  if (!hashMatch) return null;
  return { pageParam: `${hashMatch[1]}_page`, totalPages };
}

// Extract the Hero featured articles. The hero is a marquee whose items are
// rendered twice on the page, so links are deduped by slug preserving first
// occurrence order, which gives heroIndex 0..N-1.
function extractHeroArticles($) {
  const hero = [];
  const seen = new Set();
  $('a[data-cta-position="Hero section"]').each((i, el) => {
    const $link = $(el);
    const slug = slugFromHref($link.attr('href'));
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    // Climb from the CTA link to its card (the ancestor containing the h2).
    let $card = $link;
    for (let depth = 0; depth < 8 && $card.length; depth++) {
      if ($card.find('h2').length) break;
      $card = $card.parent();
    }

    hero.push({
      slug,
      title: $card.find('h2').first().text().trim(),
      date: toLongDate($card.find('.u-text-style-caption.u-foreground-tertiary').first().text().trim()),
      illustrationUrl: $card.find('img').first().attr('src') || '',
      illustrationBg: $card.find('[data-illustration-bg]').first().attr('data-illustration-bg') || '',
      heroIndex: hero.length,
      inHero: true,
    });
  });
  return hero;
}

// Category fallback for hero-only articles: read it from the article's own
// page, scoped to the article's own header section (hero_blog_post_wrap),
// never "the first fs-list-field on the page" (that also matches recommended
// article cards). blog_post_section_wrap is kept as a secondary scope for
// robustness.
function extractCategoryFromArticlePage(html) {
  const $ = cheerio.load(html);
  for (const sectionSel of ['section.hero_blog_post_wrap', 'section.blog_post_section_wrap']) {
    let category = '';
    $(sectionSel).each((i, sec) => {
      if (category) return;
      $(sec).find('li').each((j, li) => {
        if (category) return;
        const $li = $(li);
        const caption = $li.find('.u-text-style-caption').first().text().trim().toLowerCase();
        if (caption === 'category') {
          category = $li.find('a').first().text().trim();
        }
      });
    });
    if (category) return category;
  }
  return '';
}

// Absolute URL for a hero detail link. Relative paths become claude.com URLs;
// empty / "#" hrefs are ignored.
function absoluteClaudeUrl(href) {
  const raw = (href || '').trim();
  if (!raw || raw === '#') return '';
  try {
    return new URL(raw, 'https://claude.com').href;
  } catch {
    return '';
  }
}

// Hero details sidebar fields from section.hero_blog_post_wrap:
// subtitle, authors[], readingMinutes, categoryUrl, productUrl.
// Falls back to meta description for subtitle and word-count estimate for
// reading time when the official page omits those nodes.
function extractHeroMetaFromArticlePage(html) {
  const $ = cheerio.load(html);
  const $hero = $('section.hero_blog_post_wrap').first();

  let subtitle = '';
  if ($hero.length) {
    subtitle = $hero.find('.hero_blog_description_wrap p').first().text().trim();
  }
  if (!subtitle) {
    subtitle = $('meta[name="description"]').attr('content') || '';
    subtitle = subtitle.trim();
  }

  const authors = [];
  $hero.find('.blog_author_text').each((i, el) => {
    const name = $(el).text().trim();
    if (name && !authors.includes(name)) authors.push(name);
  });

  let readingMinutes = 0;
  const minutesText = $hero.find('[data-readtime="minutes"]').first().text().trim();
  if (minutesText) {
    const n = parseInt(minutesText, 10);
    if (!isNaN(n) && n > 0) readingMinutes = n;
  }
  if (!readingMinutes) {
    const contentText = $('div[data-readtime="content"]').first().text().trim()
      || $('section.blog_post_section_wrap .w-richtext').first().text().trim();
    if (contentText) {
      const words = contentText.split(/\s+/).filter(Boolean).length;
      readingMinutes = Math.max(1, Math.round(words / 200));
    }
  }

  let categoryUrl = '';
  let productUrl = '';
  $hero.find('li.hero_blog_post_details_item').each((i, li) => {
    const $li = $(li);
    const caption = $li.find('.u-text-style-caption').first().text().trim().toLowerCase();
    if (caption === 'category' && !categoryUrl) {
      categoryUrl = absoluteClaudeUrl($li.find('a').first().attr('href'));
    }
    if (caption === 'product' && !productUrl) {
      productUrl = absoluteClaudeUrl($li.find('a').first().attr('href'));
    }
  });

  return { subtitle, authors, readingMinutes, categoryUrl, productUrl };
}

// Facets (category/product/usecase) for one article. The listing cards expose
// only category; product/usecase live in a hidden metadata block
// (u-display-none) on the article's own page, each tagged with
// fs-list-field="product" / fs-list-field="usecase". Category and Product also
// come from the hero details list. Returns { category: [], product: [], usecase: [] }
// — always all three keys so callers can spread the result unconditionally.
function extractFacetsFromArticlePage(html) {
  const $ = cheerio.load(html);
  const facets = { category: [], product: [], usecase: [] };
  const pushUnique = (field, value) => {
    if (value && !facets[field].includes(value)) facets[field].push(value);
  };
  // Category / Product: each link under the matching hero details caption.
  $('section.hero_blog_post_wrap li.hero_blog_post_details_item').each((i, li) => {
    const $li = $(li);
    const caption = $li.find('.u-text-style-caption').first().text().trim().toLowerCase();
    if (caption === 'category') {
      $li.find('a').each((j, a) => pushUnique('category', $(a).text().trim()));
    }
    if (caption === 'product') {
      $li.find('a').each((j, a) => pushUnique('product', $(a).text().trim()));
    }
  });
  // Product / usecase: the hidden metadata block, all values.
  $('.u-display-none [fs-list-field="product"]').each((i, el) => pushUnique('product', $(el).text().trim()));
  $('.u-display-none [fs-list-field="usecase"]').each((i, el) => pushUnique('usecase', $(el).text().trim()));
  return facets;
}

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Site chrome that sits in the article template but is not article body:
// empty FAQ shells, "Get Claude Code Desktop" install strips, leftover CTAs.
function isChromeBlock($el) {
  const text = $el.text().replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/FAQ\s+No items found/i.test(text) && text.length < 600) return true;
  if (/Get Claude Code Desktop/i.test(text) && text.length < 600) return true;
  if (/^(Try now\s*)+$/i.test(text)) return true;
  if (/Learn more\.?(\s+Learn more\.?)+$/i.test(text) && text.length < 220) return true;
  return false;
}

function logoLabel(src) {
  const name = path.basename(src || '').replace(/\.(svg|png|webp|jpe?g)$/i, '');
  return name
    .replace(/[-_](light|dark|color|black|white|logo|logo\.svg)+/ig, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTestimonialCards($, $root) {
  const cards = [];
  const seen = new Set();
  $root.find('.card_testimonial_col_layout').each((i, el) => {
    const $el = $(el);
    const text = $el.find('.card_testimonial_col_text').first().text().replace(/\s+/g, ' ').trim();
    if (text.length < 40 || seen.has(text)) return;
    seen.add(text);
    const caption = $el.find('.card_testimonial_col_caption').first().text().replace(/\s+/g, ' ').trim();
    const $logo = $el.find('img.logo_light, img.illustration_light').first();
    cards.push({
      text,
      caption,
      logo: $logo.attr('src') || '',
      alt: logoLabel($logo.attr('src') || '') || ($logo.attr('alt') || '').trim(),
    });
  });
  return cards;
}

function renderTestimonials(cards) {
  if (!cards.length) return '';
  const items = cards.map((card) => {
    const logo = card.logo
      ? `<img class="article-testimonial-logo" src="${htmlEscape(card.logo)}" alt="${htmlEscape(card.alt)}" loading="lazy">`
      : '';
    const caption = card.caption
      ? `<figcaption class="article-testimonial-caption">${htmlEscape(card.caption)}</figcaption>`
      : '';
    return `<figure class="article-testimonial" role="listitem">${logo}<blockquote><p>${htmlEscape(card.text)}</p></blockquote>${caption}</figure>`;
  });
  return `<div class="article-testimonials" role="list">${items.join('')}</div>`;
}

function extractFaqItems($, $root) {
  const items = [];
  const seen = new Set();
  $root.find('.accordion_item').each((i, el) => {
    const $el = $(el);
    const question = $el.find('.accordion_toggle_text').first().text().replace(/\s+/g, ' ').trim();
    const $answer = $el.find('.accordion_content_text').first();
    if (!question || seen.has(question) || !$answer.length) return;
    seen.add(question);
    items.push({ question, html: $answer.html() || '' });
  });
  return items;
}

function renderFaq(items) {
  if (!items.length) return '';
  const body = items.map((item) => `<h3>${htmlEscape(item.question)}</h3>${item.html}`).join('');
  return `<h2>FAQ</h2><div class="article-faq">${body}</div>`;
}

function normalizedBodyText(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

// Write content/en/<slug>/content.html from a cached official page.
// Skips the write when normalized text is unchanged so a listing-only fetch
// does not dirty every article or flip translationStale.
function writeExtractedContent(articleDir, articleHtml) {
  const extracted = extractArticleContent(articleHtml);
  if (!extracted) {
    return { written: false, prevChars: 0, nextChars: 0 };
  }
  const dest = path.join(articleDir, 'content.html');
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf-8') : '';
  const prevText = normalizedBodyText(prev);
  const nextText = normalizedBodyText(extracted);
  if (prevText === nextText) {
    return { written: false, prevChars: prevText.length, nextChars: nextText.length };
  }
  fs.writeFileSync(dest, extracted, 'utf-8');
  return { written: true, prevChars: prevText.length, nextChars: nextText.length };
}

// Official posts are not a single richtext node. The template concatenates:
//   1) one or more [data-readtime="content"] body blocks
//   2) an optional CMS testimonial slider (.is_testimonials)
// in document order. Taking only .first() drops Getting started, FAQ answers,
// and every quote card — which is why some local pages look truncated.
function extractArticleContent(html) {
  const $ = cheerio.load(html);
  const pieces = [];

  const pushRichtext = ($el) => {
    if (!$el || !$el.length || isChromeBlock($el)) return;
    const inner = $el.html();
    if (inner && $el.text().replace(/\s+/g, ' ').trim().length > 40) {
      pieces.push(inner);
    }
  };

  const walk = (node) => {
    if (!node) return;
    const $el = $(node);
    if ($el.is('div[data-readtime="content"]')) {
      pushRichtext($el);
      return;
    }
    if (
      $el.hasClass('is_testimonials')
      || $el.hasClass('slider_component')
      || ($el.hasClass('blog_post_layout') && $el.find('.card_testimonial_col_layout').length)
    ) {
      const html = renderTestimonials(extractTestimonialCards($, $el));
      if (html) pieces.push(html);
      return;
    }
    if ($el.hasClass('faq_section_wrap')) {
      const faqHtml = renderFaq(extractFaqItems($, $el));
      if (faqHtml) pieces.push(faqHtml);
      return;
    }
    if (
      $el.hasClass('card_full_layout')
      || $el.hasClass('blog_related_section_wrap')
      || $el.hasClass('hero_blog_post_wrap')
    ) {
      return;
    }
    $el.children().each((i, child) => walk(child));
  };

  const $scope = $('.blog_post_component').first();
  if ($scope.length) {
    walk($scope.get(0));
  }

  if (!pieces.length) {
    const contentDiv = $('div[data-readtime="content"].w-richtext').first();
    if (contentDiv.length && contentDiv.text().trim().length > 0) {
      return $.html(contentDiv);
    }
    const blogSection = $('section.blog_post_section_wrap').first();
    if (blogSection.length) {
      const richtext = blogSection.find('.w-richtext.u-rich-text-blog').first();
      if (richtext.length && richtext.text().trim().length > 100) {
        return $.html(richtext);
      }
    }
    let found = null;
    $('.w-richtext').each((i, el) => {
      if (found) return;
      const $el = $(el);
      const text = $el.text().trim();
      if (text.length > 500 && !$el.closest('header').length && !$el.closest('footer').length) {
        found = $.html($el);
      }
    });
    return found;
  }

  return `<div data-readtime="content" class="u-rich-text-blog u-margin-trim w-richtext">${pieces.join('')}</div>`;
}

function illustrationExtension(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ext && /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.svg';
}

const illoStats = { downloaded: 0, skipped: 0, failed: 0 };

async function downloadIllustration(slug, url) {
  if (!url) return '';
  const ext = illustrationExtension(url);
  const fileName = `${slug}${ext}`;
  const dest = path.join(ILLUSTRATION_DIR, fileName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    illoStats.skipped++;
    return `assets/illustrations/${fileName}`;
  }
  try {
    const data = await fetch(url, { binary: true });
    fs.mkdirSync(ILLUSTRATION_DIR, { recursive: true });
    fs.writeFileSync(dest, data);
    illoStats.downloaded++;
    return `assets/illustrations/${fileName}`;
  } catch (err) {
    illoStats.failed++;
    console.warn(`  ⚠ Failed to download illustration for ${slug}: ${err.message}`);
    return '';
  }
}

function loadIndex() {
  if (fs.existsSync(META_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
      if (parsed && Array.isArray(parsed.articles)) return parsed;
    } catch (err) {
      console.warn(`  ⚠ Could not parse existing index.json (${err.message}); starting fresh`);
    }
  }
  return { articles: [], lastFetched: null };
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function main() {
  console.log('Fetching blog listing...');
  const listingHtml = await fetch(BASE_URL);
  const $listing = cheerio.load(listingHtml);

  const grid = extractGridArticles($listing);
  const hero = extractHeroArticles($listing);
  console.log(`  Found ${grid.size} grid articles and ${hero.length} hero articles on page 1`);

  // Pagination: the Webflow CMS uses a hash-prefixed param
  // (?<hash>_page=N). The hash is extracted dynamically from the grid's
  // "View more" link because it changes over time. When the total page count
  // is known, pages are fetched concurrently (pool of PAGE_CONCURRENCY);
  // otherwise pages are walked sequentially, stopping as soon as a page adds
  // no new slugs (the CMS re-serves page 1 past the end).
  const pagination = extractPagination($listing);
  if (pagination) {
    console.log(`  Pagination param: ?${pagination.pageParam}=N, total pages: ${pagination.totalPages || 'unknown'}`);
  } else {
    console.log('  No pagination found on page 1; treating listing as a single page');
  }

  if (pagination && pagination.totalPages && pagination.totalPages > 1) {
    const lastPage = Math.min(pagination.totalPages, MAX_PAGES);
    const pages = [];
    for (let p = 2; p <= lastPage; p++) pages.push(p);
    let done = 0;
    await runPool(pages, PAGE_CONCURRENCY, async (page) => {
      const html = await fetch(`${BASE_URL}?${pagination.pageParam}=${page}`);
      const $page = cheerio.load(html);
      const pageGrid = extractGridArticles($page);
      // Merge synchronously (safe inside the pool: no await in this block).
      let newCount = 0;
      for (const [slug, card] of pageGrid) {
        const existing = grid.get(slug);
        if (!existing) {
          grid.set(slug, card);
          newCount++;
        } else if (!existing.illustrationUrl && card.illustrationUrl) {
          grid.set(slug, { ...card });
        }
      }
      done++;
      console.log(`  Page ${page}: ${pageGrid.size} cards, ${newCount} new (${done}/${pages.length})`);
    });
  } else if (pagination) {
    // Unknown total page count: walk pages one by one and stop on the first
    // page that yields no new slugs.
    for (let page = 2; page <= MAX_PAGES; page++) {
      const prevCount = grid.size;
      const html = await fetch(`${BASE_URL}?${pagination.pageParam}=${page}`);
      const $page = cheerio.load(html);
      for (const [slug, card] of extractGridArticles($page)) {
        const existing = grid.get(slug);
        if (!existing) {
          grid.set(slug, card);
        } else if (!existing.illustrationUrl && card.illustrationUrl) {
          grid.set(slug, { ...card });
        }
      }
      console.log(`  Page ${page}: ${grid.size - prevCount} new articles`);
      if (grid.size === prevCount) break;
    }
  }

  // Merge hero data into the combined article map.
  const articles = new Map(grid);
  for (const heroArticle of hero) {
    const existing = articles.get(heroArticle.slug);
    if (existing) {
      existing.inHero = true;
      existing.heroIndex = heroArticle.heroIndex;
      if (heroArticle.date && !existing.date) existing.date = heroArticle.date;
      if (heroArticle.title && !existing.title) existing.title = heroArticle.title;
      if (heroArticle.illustrationUrl && !existing.illustrationUrl) {
        existing.illustrationUrl = heroArticle.illustrationUrl;
        existing.illustrationBg = heroArticle.illustrationBg;
      }
    } else {
      articles.set(heroArticle.slug, { ...heroArticle, inGrid: false });
    }
  }

  console.log(`Total ${articles.size} unique articles (grid + hero)`);

  const index = loadIndex();
  const indexBySlug = new Map(index.articles.map((a) => [a.slug, a]));

  // Download all illustrations concurrently (best effort; failures warn but
  // never abort). Only grid cards have a card_blog_illo image — hero-only
  // articles have no illustration on the official site, so theirs stays ''.
  console.log(`Downloading illustrations for ${[...articles.values()].filter((a) => a.illustrationUrl).length} articles...`);
  const illustrationPaths = new Map();
  const illoTargets = [...articles.values()].filter((a) => a.illustrationUrl);
  await runPool(illoTargets, ILLO_CONCURRENCY, async (article) => {
    const p = await downloadIllustration(article.slug, article.illustrationUrl);
    illustrationPaths.set(article.slug, p);
  });
  console.log(`  Illustrations: ${illoStats.downloaded} downloaded, ${illoStats.skipped} already present, ${illoStats.failed} failed`);

  let newCount = 0;
  let updatedCount = 0;
  let contentRefreshed = 0;
  let contentUnchanged = 0;
  const staleSlugs = new Set();

  for (const article of articles.values()) {
    const existing = indexBySlug.get(article.slug);
    const articleDir = path.join(CONTENT_DIR, article.slug);
    const htmlFile = path.join(articleDir, 'article.html');
    const isNew = !existing;

    if (isNew) console.log(`NEW: ${article.slug} — ${article.title || '(untitled)'}`);

    // Article bodies: previously fetched pages are kept as-is. Articles
    // without a stored page are fetched once here (metadata-only run) so
    // their facets are available; the site build already skips article pages
    // that do not exist.
    let articleHtml = null;
    if (fs.existsSync(htmlFile)) {
      articleHtml = fs.readFileSync(htmlFile, 'utf-8');
    } else {
      try {
        articleHtml = await fetch(`https://claude.com/blog/${article.slug}`);
        fs.mkdirSync(articleDir, { recursive: true });
        fs.writeFileSync(htmlFile, articleHtml, 'utf-8');
      } catch (err) {
        console.warn(`  ⚠ Could not fetch ${article.slug}: ${err.message}`);
      }
    }

    // Refresh the English body from the cached official page so extra CMS
    // blocks (testimonials, a second Getting started richtext, real FAQs)
    // are not lost. Only rewrite when the extracted text actually changed.
    if (articleHtml) {
      const extracted = writeExtractedContent(articleDir, articleHtml);
      if (extracted.written) {
        contentRefreshed++;
        const zhFile = path.join(__dirname, '..', 'content', 'zh', article.slug, 'content.html');
        if (fs.existsSync(zhFile) && extracted.nextChars > extracted.prevChars + 80) {
          staleSlugs.add(article.slug);
        }
      } else {
        contentUnchanged++;
      }
    }

    // Category: the listing page is the single source of truth. Only hero-only
    // articles fall back to their own (already stored) article page.
    let category = article.category || '';
    if (!category && articleHtml) {
      category = extractCategoryFromArticlePage(articleHtml);
    }
    if (!category) {
      category = (existing && existing.category) || 'General';
    }

    // Facets: the listing page only exposes category; product/usecase live on
    // the article's own page. Extract all three when the page is available,
    // otherwise keep the stored facets unchanged.
    const facets = articleHtml
      ? extractFacetsFromArticlePage(articleHtml)
      : (existing && existing.facets) || null;

    // Hero sidebar meta (subtitle, authors, reading time, detail URLs).
    // Prefer a fresh parse; keep previously stored values when the page is
    // missing so a transient fetch failure does not wipe fields.
    const heroMeta = articleHtml
      ? extractHeroMetaFromArticlePage(articleHtml)
      : {
          subtitle: (existing && existing.subtitle) || '',
          authors: (existing && existing.authors) || [],
          readingMinutes: (existing && existing.readingMinutes) || 0,
          categoryUrl: (existing && existing.categoryUrl) || '',
          productUrl: (existing && existing.productUrl) || '',
        };

    // Illustration path: fresh download wins, otherwise keep the known path.
    const illustrationPath = illustrationPaths.get(article.slug)
      || (existing && existing.illustration)
      || '';

    // Build the listing-derived record. heroIndex: -1 when not in the hero.
    const listingRecord = {
      slug: article.slug,
      title: article.title || (existing && existing.title) || article.slug,
      date: article.date || (existing && existing.date) || '',
      category,
      url: `https://claude.com/blog/${article.slug}`,
      inHero: Boolean(article.inHero),
      heroIndex: typeof article.heroIndex === 'number' ? article.heroIndex : -1,
      inGrid: Boolean(article.inGrid),
      illustration: illustrationPath,
      illustrationBg: article.illustrationBg || '',
      facets,
      subtitle: heroMeta.subtitle || '',
      authors: Array.isArray(heroMeta.authors) ? heroMeta.authors : [],
      readingMinutes: heroMeta.readingMinutes || 0,
      categoryUrl: heroMeta.categoryUrl || '',
      productUrl: heroMeta.productUrl || '',
    };

    // Merge into the index entry, preserving translation fields and fetchedAt.
    const merged = {
      ...(existing || {}),
      ...listingRecord,
      fetchedAt: (existing && existing.fetchedAt) || new Date().toISOString(),
    };
    if (staleSlugs.has(article.slug)) {
      merged.translationStale = true;
    }
    if (existing) {
      const idx = index.articles.findIndex((a) => a.slug === article.slug);
      index.articles[idx] = merged;
      updatedCount++;
    } else {
      merged.translated = false;
      index.articles.push(merged);
      indexBySlug.set(merged.slug, merged);
      newCount++;
    }

    // Per-article meta.json: merge, never replace — only for articles whose
    // content directory already exists (new articles get their body fetched
    // above, so the directory is created for them too).
    const metaFile = path.join(articleDir, 'meta.json');
    if (fs.existsSync(articleDir)) {
      let articleMeta = {};
      if (fs.existsSync(metaFile)) {
        try { articleMeta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')); } catch (err) {
          console.warn(`  ⠿ Could not parse existing meta.json for ${article.slug}: ${err.message}`);
        }
      }
      writeJson(metaFile, {
        ...articleMeta,
        ...listingRecord,
        fetchedAt: articleMeta.fetchedAt || merged.fetchedAt,
      });
    }
  }

  // Sort by date descending; hero-only articles use their real dates.
  index.articles.sort((a, b) => {
    const da = new Date(a.date || 'Invalid').getTime();
    const db = new Date(b.date || 'Invalid').getTime();
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });
  index.lastFetched = new Date().toISOString();
  writeJson(META_FILE, index);

  const inHeroCount = index.articles.filter((a) => a.inHero).length;
  const inGridCount = index.articles.filter((a) => a.inGrid).length;
  const translatedCount = index.articles.filter((a) => a.translated).length;
  console.log(`\nDone! ${newCount} new, ${updatedCount} updated, ${index.articles.length} total`);
  console.log(`  inHero: ${inHeroCount}, inGrid: ${inGridCount}, translated: ${translatedCount}`);
  console.log(`  illustrations: ${illoStats.downloaded} downloaded, ${illoStats.skipped} kept, ${illoStats.failed} failed`);
  console.log(`  content.html: ${contentRefreshed} refreshed, ${contentUnchanged} unchanged, ${staleSlugs.size} translations marked stale`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nFATAL: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  extractArticleContent,
  extractTestimonialCards,
  extractFaqItems,
  isChromeBlock,
  normalizedBodyText,
  writeExtractedContent,
};
