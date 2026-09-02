#!/usr/bin/env node
/**
 * build-site.js
 * Generates the static site from fetched content.
 * Creates:
 *   - index.html (blog home: hero carousel + main grid)
 *   - posts/[slug]/index.html (each article page)
 *   - posts/[slug]/en.html (English original page)
 *   - rss.xml
 *
 * Environment variables:
 *   BASE_PATH    - path prefix for GitHub Pages subpath, e.g. /claude-blog-cn
 *   SITE_URL     - base URL for RSS, e.g. https://fanyangyang.github.io/claude-blog-cn
 *   INDEX_FILE   - override input metadata JSON (default: content/index.json)
 *   OUT_DIR      - override output directory (default: repo root)
 *
 * Data contract for content/index.json articles[]:
 *   slug, title, date (long format, e.g. "August 28, 2026"), category, url,
 *   fetchedAt, translated, translatedTitle, plus:
 *   inHero: boolean        - featured in home hero carousel
 *   heroIndex: number      - order inside the hero carousel (0-based)
 *   inGrid: boolean        - appears in the home main grid
 *   illustration: string   - repo-relative path, no leading slash
 *   illustrationBg: string - palette name, e.g. "Clay"
 */

const fs = require('fs');
const path = require('path');

const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || 'https://fanyangyang.github.io/claude-blog-cn').replace(/\/$/, '');

const REPO_DIR = path.join(__dirname, '..');
const META_FILE = process.env.INDEX_FILE
  ? path.resolve(process.env.INDEX_FILE)
  : path.join(REPO_DIR, 'content', 'index.json');
const ZH_DIR = path.join(REPO_DIR, 'content', 'zh');
const EN_DIR = path.join(REPO_DIR, 'content', 'en');
const SITE_DIR = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : REPO_DIR;

// Official Claude palette (data-illustration-bg name -> swatch hex, extracted
// from claude.com blog inline styles + claude-brand.shared CSS).
const ILLO_FALLBACK = 'clay';
const ILLO_NAMES = new Set([
  'clay', 'heather', 'peach', 'sky', 'plum',
  'cactus', 'mineral', 'olive', 'coral', 'fig', 'oat',
]);

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function htmlEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ===== Dates (defensive — never emit "Invalid Date" / "Unknown") ===== */

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// "August 28, 2026" -> "Aug 28, 2026"; null when unparseable (caller omits the node).
function toShortDate(value) {
  const d = parseDate(value);
  if (!d) return null;
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// RSS pubDate: fall back to fetchedAt, then to now. Never "Invalid Date".
function rssPubDate(article) {
  const d = parseDate(article.date) || parseDate(article.fetchedAt) || new Date();
  return d.toUTCString();
}

/* ===== Palette ===== */

function illoVar(name) {
  const key = String(name || '').trim().toLowerCase();
  return `--illo-${ILLO_NAMES.has(key) ? key : ILLO_FALLBACK}`;
}

/* ===== Article helpers ===== */

function hasZhContent(article) {
  return fs.existsSync(path.join(ZH_DIR, article.slug, 'content.html'));
}

function hasEnContent(article) {
  return fs.existsSync(path.join(EN_DIR, article.slug, 'content.html'));
}

function articleTitle(article, hasZh) {
  return hasZh && article.translatedTitle ? article.translatedTitle : article.title;
}

// Local zh page > local en page > official URL (so untranslated, unfetched
// articles never link to a 404 local en.html).
function articleLink(article, hasZh) {
  if (hasZh) return `${BASE_PATH}/posts/${article.slug}/`;
  if (hasEnContent(article)) return `${BASE_PATH}/posts/${article.slug}/en.html`;
  return article.url || `https://claude.com/blog/${article.slug}`;
}

// True when the card should open in a new tab (external official link).
function isExternalLink(article, hasZh) {
  return !hasZh && !hasEnContent(article);
}

function illoSrc(article) {
  return `${BASE_PATH}/${String(article.illustration || '').replace(/^\//, '')}`;
}

/* ===== Shared layout (DRY: one head/header/footer for all pages) ===== */

function renderHeader(navLinks) {
  const links = navLinks
    .map(l => `<a href="${l.href}" class="nav-link${l.active ? ' active' : ''}"${l.external ? ' target="_blank"' : ''}>${l.label}</a>`)
    .join('\n          ');
  return `<header class="header">
    <div class="container">
      <div class="header-inner">
        <a href="${BASE_PATH}/" class="logo">
          <span class="logo-text">Claude Blog <span class="logo-cn">中文</span></span>
        </a>
        <nav class="nav">
          ${links}
        </nav>
      </div>
    </div>
  </header>`;
}

function renderFooter(variant, meta) {
  if (variant === 'en') {
    return `<footer class="footer">
    <div class="container">
      <p>Content from <a href="https://claude.com/blog" target="_blank">Claude Blog</a> · Translation by AI</p>
    </div>
  </footer>`;
  }
  const updated = meta && meta.lastFetched
    ? `<p class="footer-meta">最后更新：${new Date(meta.lastFetched).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>`
    : '';
  return `<footer class="footer">
    <div class="container">
      <p>内容来自 <a href="https://claude.com/blog" target="_blank">Claude Blog</a> · 翻译由 AI 生成 · <a href="https://github.com/fanyangyang/claude-blog-cn" target="_blank">GitHub 仓库</a></p>
      ${updated}
    </div>
  </footer>`;
}

/**
 * Shared page shell. All asset references go through ${BASE_PATH}.
 */
function renderPage({ lang, title, description, body, headExtra = '', navLinks, footerVariant, meta = null, bodyExtra = '' }) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}">
  <link rel="stylesheet" href="${BASE_PATH}/assets/style.css">
  <link rel="alternate" type="application/rss+xml" title="Claude Blog 中文翻译 RSS" href="${BASE_PATH}/rss.xml">
  ${headExtra}
</head>
<body>
${renderHeader(navLinks)}
${body}
${renderFooter(footerVariant, meta)}
${bodyExtra}
</body>
</html>`;
}

const HOME_NAV = [
  { href: `${BASE_PATH}/`, label: '首页', active: true },
  { href: `${BASE_PATH}/rss.xml`, label: 'RSS' },
  { href: 'https://claude.com/blog', label: '原文 →', external: true },
];

function articleNav(article) {
  return [
    { href: `${BASE_PATH}/`, label: '首页' },
    { href: `https://claude.com/blog/${article.slug}`, label: '原文 →', external: true },
  ];
}

/* ===== Home: marquee strip + filter sidebar + paginated grid ===== */
//
// Mirrors the official claude.com/blog layout (values extracted from
// claude.com/blog HTML + claude-brand.shared CSS; see /tmp/official-spec.md):
//   1. Marquee strip  — edge-to-edge, border-top only, border-left item
//                       separators, title above / date below, 60s linear loop.
//   2. Sidebar        — "Filter and sort" + 4 accordion groups
//                       (Sort by select / Category / Product / Use case).
//   3. Toolbar        — search input + grid/list toggle.
//   4. Main grid      — illustration cards, "View more" reveals the next batch.

// Official facet-panel option lists, in the official order (spec 2.4).
// Options are generated dynamically from index.json facets; these lists fix
// the order and guarantee the official panel's full option set.
const FACET_ORDER = {
  category: ['Agents', 'Claude Code', 'Enterprise AI', 'Product announcements'],
  product: [
    'Claude Science', 'Claude Tag', 'Claude Design', 'Claude Security',
    'Claude Cowork', 'Claude Enterprise', 'Claude apps', 'Claude Platform',
    'Claude Code',
  ],
  usecase: [
    'Agents', 'Business', 'Coding', 'Content Creation', 'Design', 'Education',
    'Financial services', 'Government', 'Health care and life sciences',
    'Learning', 'Legal', 'Productivity', 'Sales', 'Startups', 'Work',
  ],
};

// Card category icons — the four official card-main_tag-icon SVG paths
// (spec 3.2), fill=currentColor inside a 1.25rem box.
const CATEGORY_ICONS = {
  'Agents': {
    viewBox: '0 0 20 20',
    d: 'M5 2.5C5.93171 2.5 6.71235 3.13768 6.93457 4H13.75C15.5449 4 17 5.45507 17 7.25C17 9.04493 15.5449 10.5 13.75 10.5H12.707L10.3535 12.8535C10.1583 13.0488 9.84175 13.0488 9.64648 12.8535L7.29297 10.5H6.25C5.00736 10.5 4 11.5074 4 12.75C4 13.9926 5.00736 15 6.25 15H13.0654C13.2877 14.1377 14.0683 13.5 15 13.5C16.1046 13.5 17 14.3954 17 15.5C17 16.6046 16.1046 17.5 15 17.5C14.0683 17.5 13.2877 16.8623 13.0654 16H6.25C4.45507 16 3 14.5449 3 12.75C3 10.9551 4.45507 9.5 6.25 9.5H7.29297L9.64648 7.14648L9.72461 7.08203C9.91869 6.95387 10.1827 6.97562 10.3535 7.14648L12.707 9.5H13.75C14.9926 9.5 16 8.49264 16 7.25C16 6.00736 14.9926 5 13.75 5H6.93457C6.71235 5.86232 5.93171 6.5 5 6.5C3.89543 6.5 3 5.60457 3 4.5C3 3.39543 3.89543 2.5 5 2.5ZM15 14.5C14.4477 14.5 14 14.9477 14 15.5C14 16.0523 14.4477 16.5 15 16.5C15.5523 16.5 16 16.0523 16 15.5C16 14.9477 15.5523 14.5 15 14.5ZM8.20703 10L10 11.793L11.793 10L10 8.20703L8.20703 10ZM5 3.5C4.44772 3.5 4 3.94772 4 4.5C4 5.05228 4.44772 5.5 5 5.5C5.55228 5.5 6 5.05228 6 4.5C6 3.94772 5.55228 3.5 5 3.5Z',
  },
  'Claude Code': {
    viewBox: '0 0 20 20',
    d: 'M11.6318 4.01757C11.898 4.09032 12.055 4.36555 11.9824 4.63183L8.98242 15.6318C8.90966 15.8981 8.63449 16.0551 8.36816 15.9824C8.10193 15.9097 7.94495 15.6345 8.01758 15.3682L11.0176 4.36816C11.0904 4.102 11.3656 3.94497 11.6318 4.01757ZM13.124 6.17089C13.3059 5.96325 13.6213 5.9423 13.8291 6.12402L17.8291 9.62402L17.9014 9.70215C17.9647 9.78754 18 9.89182 18 10C18 10.1441 17.9375 10.281 17.8291 10.376L13.8291 13.876L13.7471 13.9346C13.5449 14.0498 13.2833 14.011 13.124 13.8291C12.9649 13.6472 12.9606 13.3824 13.1016 13.1973L13.1709 13.124L16.7412 10L13.1709 6.87597C12.9632 6.69411 12.9422 6.37866 13.124 6.17089ZM6.25293 6.06542C6.45509 5.95025 6.71675 5.98908 6.87598 6.17089C7.03513 6.35279 7.03933 6.6176 6.89844 6.80273L6.8291 6.87597L3.25879 10L6.8291 13.124C7.03682 13.3059 7.05771 13.6213 6.87598 13.8291C6.69413 14.0369 6.37869 14.0578 6.1709 13.876L2.1709 10.376L2.09863 10.2979C2.03528 10.2124 2 10.1082 2 10C2.00005 9.85591 2.06247 9.71893 2.1709 9.62402L6.1709 6.12402L6.25293 6.06542Z',
  },
  'Enterprise AI': {
    viewBox: '0 0 20 21',
    d: 'M11.1357 2.74322C12.0824 2.50658 12.9999 3.22351 13 4.19928V7.66803H15.5C16.3284 7.66803 16.9999 8.33968 17 9.16804V16.168C17 16.9965 16.3284 17.668 15.5 17.668H4.5C3.67157 17.668 3 16.9965 3 16.168V5.94928C3.00007 5.26116 3.46822 4.66027 4.13574 4.49323L11.1357 2.74322ZM11.3789 3.71393L4.37891 5.46393C4.15637 5.51956 4.00007 5.71991 4 5.94928V16.168C4 16.4442 4.22386 16.668 4.5 16.668H6V13.168L6.00977 13.0675C6.05635 12.8396 6.25834 12.668 6.5 12.668H9.5L9.60059 12.6778C9.8285 12.7243 9.99993 12.9264 10 13.168V16.668H12V4.19928C11.9999 3.87413 11.6944 3.63516 11.3789 3.71393ZM7 16.668H9V13.668H7V16.668ZM13 16.668H15.5C15.7761 16.668 16 16.4442 16 16.168V9.16804C15.9999 8.89196 15.7761 8.66804 15.5 8.66804H13V16.668ZM9.5 9.66804C9.77609 9.66804 9.99992 9.89196 10 10.168C10 10.4442 9.77614 10.668 9.5 10.668H6.5C6.22386 10.668 6 10.4442 6 10.168C6.00008 9.89196 6.22391 9.66804 6.5 9.66804H9.5ZM9.5 6.66803C9.77609 6.66803 9.99992 6.89196 10 7.16803C10 7.44418 9.77614 7.66803 9.5 7.66803H6.5C6.22386 7.66803 6 7.44418 6 7.16803C6.00008 6.89196 6.22391 6.66803 6.5 6.66803H9.5Z',
  },
  'Product announcements': {
    viewBox: '0 0 20 21',
    d: 'M11.0974 2.71554C11.856 2.03302 13.1023 2.29753 13.4919 3.28585L14.4558 5.73214C15.6023 5.52954 16.7713 6.15473 17.2146 7.27999C17.6577 8.40523 17.2274 9.65704 16.2507 10.2907L17.2155 12.739C17.6307 13.7934 16.7716 14.9102 15.6462 14.779L11.3728 14.278L12.3366 16.7243C12.6402 17.495 12.2616 18.3659 11.4909 18.6696L10.5603 19.0368C9.78955 19.3403 8.91855 18.9609 8.61496 18.1901L7.33176 14.9343L6.86692 15.1179C5.06849 15.8261 3.03626 14.9417 2.32785 13.1433C1.61968 11.3449 2.50312 9.31261 4.30149 8.60421L6.8591 7.59737C6.93575 7.56718 7.00404 7.5176 7.05735 7.4548L10.9529 2.86495L11.0974 2.71554ZM9.66672 14.0788C9.5849 14.0692 9.50118 14.0799 9.42453 14.1101L8.26242 14.5671L9.54563 17.8239C9.64683 18.0809 9.93714 18.2074 10.1941 18.1062L11.1247 17.74C11.3814 17.6387 11.5074 17.3483 11.406 17.0915L10.2468 14.1462L9.66672 14.0788ZM4.6677 9.53487C3.38326 10.041 2.75255 11.4925 3.25852 12.7771C3.76455 14.0617 5.21607 14.6932 6.50071 14.1872L8.8259 13.2702L6.99387 8.61788L4.6677 9.53487ZM12.5613 3.65304C12.4313 3.32368 12.0162 3.23514 11.7634 3.46261L11.7146 3.51241L7.85031 8.06417L9.82981 13.0905L15.7614 13.7858C16.1366 13.8297 16.4229 13.4576 16.2849 13.1062L12.5613 3.65304ZM14.8357 6.69796L15.8708 9.32687C16.3372 8.92173 16.5232 8.25376 16.2839 7.6462C16.0446 7.0387 15.453 6.67619 14.8357 6.69796Z',
  },
};

// Official search icon (toolbar form_main_icon svg, spec 2.5).
const SEARCH_ICON_PATH = 'M8.5 2C12.0899 2 15 4.91015 15 8.5C15 10.1149 14.4094 11.5908 13.4346 12.7275L17.8535 17.1465L17.918 17.2246C18.0461 17.4187 18.0244 17.6827 17.8535 17.8535C17.6827 18.0244 17.4187 18.0461 17.2246 17.918L17.1465 17.8535L12.7275 13.4346C11.5908 14.4094 10.1149 15 8.5 15C4.91015 15 2 12.0899 2 8.5C2 4.91015 4.91015 2 8.5 2ZM8.5 3C5.46243 3 3 5.46243 3 8.5C3 11.5376 5.46243 14 8.5 14C11.5376 14 14 11.5376 14 8.5C14 5.46243 11.5376 3 8.5 3Z';

// Official accordion chevron (stories_filters_dropdown_icon is-mobile svg).
const CHEVRON_ICON_PATH = 'M14.128 7.16482C14.3126 6.95983 14.6298 6.94336 14.835 7.12771C15.0402 7.31242 15.0567 7.62952 14.8721 7.83477L10.372 12.835L10.2939 12.9053C10.2093 12.9667 10.1063 13 9.99995 13C9.85833 12.9999 9.72264 12.9402 9.62788 12.835L5.12778 7.83477L5.0682 7.75273C4.95072 7.55225 4.98544 7.28926 5.16489 7.12771C5.34445 6.96617 5.60969 6.95939 5.79674 7.09744L5.87193 7.16482L9.99995 11.7519L14.128 7.16482Z';

function categoryIcon(category) {
  const icon = CATEGORY_ICONS[category];
  if (!icon) return '';
  return `<span class="card-main_tag-icon"><svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="${icon.viewBox}" fill="none" aria-hidden="true" class="u-svg"><path d="${icon.d}" fill="currentColor"/></svg></span>`;
}

// Facet values for one article: prefer index.json facets (spec 4.2), fall
// back to the single legacy category field.
function facetValues(article, field) {
  const f = article.facets || {};
  const list = Array.isArray(f[field]) ? f[field].filter(Boolean) : [];
  if (list.length > 0) return list;
  // Legacy fallback: keep the single category field only when it is one of the
  // four official categories (some fetched posts have no category at all on
  // claude.com — never invent one, e.g. "General").
  if (field === 'category' && article.category
      && FACET_ORDER.category.includes(article.category)) {
    return [article.category];
  }
  return [];
}

function facetDataAttr(article, field) {
  const values = facetValues(article, field);
  return values.length ? htmlEscape(values.join('|')) : '';
}

// Options per facet group: official order first (spec 2.4), then any extra
// values discovered in index.json facets (appended alphabetically).
function facetOptions(articles, field) {
  const seen = new Set();
  for (const a of articles) {
    for (const v of facetValues(a, field)) seen.add(v);
  }
  const order = FACET_ORDER[field] || [];
  const options = order.slice();
  const extras = [...seen].filter(v => !order.includes(v)).sort();
  return options.concat(extras);
}

function marqueeCard(a) {
  const hasZh = hasZhContent(a);
  const title = articleTitle(a, hasZh);
  const langBadge = hasZh ? '' : '<span class="lang-badge">EN</span>';
  const date = a.date ? `<div class="u-text-style-caption u-foreground-tertiary">${htmlEscape(a.date)}</div>` : '';
  // Official marquee item (spec 1.1): title (h6 style) above, long-format
  // date below, whole card covered by an absolute clickable link.
  return `        <div role="listitem" class="marquee_cms_blog_list_item">
          <div class="marquee_cms_blog_list_item_content">
            <h2 class="u-text-style-h6 u-mb-1 u-text-wrap-balance">${htmlEscape(title)}${langBadge}</h2>
            ${date}
          </div>
          <div class="clickable_wrap u-cover-absolute">
            <a href="${articleLink(a, hasZh)}" class="clickable_link"${isExternalLink(a, hasZh) ? ' target="_blank" rel="noopener noreferrer"' : ''} aria-label="${htmlEscape(title)}"><span class="u-sr-only">Read more</span></a>
          </div>
        </div>`;
}

function marqueeSection(hero) {
  if (hero.length === 0) return '';
  const items = hero.map(marqueeCard).join('\n');
  // Official structure (spec 1.1/1.2): marquee_wrap (edge-to-edge, border-top
  // + border-bottom, 2rem vertical padding) > wrapper (animated) > list of 10
  // featured articles duplicated once for a seamless loop.
  return `  <section class="marquee_wrap" aria-label="精选文章">
    <div class="marquee_cms_blog_list_wrapper">
      <div role="list" class="marquee_cms_blog_list">
${items}
${items}
      </div>
    </div>
  </section>

`;
}

function gridCards(articles) {
  return articles.map((a) => {
    const hasZh = hasZhContent(a);
    const title = articleTitle(a, hasZh);
    const langBadge = hasZh ? '' : '<span class="lang-badge">EN</span>';
    const shortDate = toShortDate(a.date);
    // Official card date: "Aug 28, 2026" (three-letter month, spec appendix).
    const dateNode = shortDate ? `\n            <div class="u-text-style-caption u-foreground-tertiary u-mb-1-5">${shortDate}</div>` : '';
    // Guard: grid cards without an illustration fall back to the swatch only.
    const illo = a.illustration
      ? `<img class="card-illo" src="${illoSrc(a)}" alt="" loading="lazy">`
      : '';
    const iso = parseDate(a.date) ? parseDate(a.date).toISOString() : '';
    // Official tag row (spec 3.1/3.3): 20px category icon + 0.5rem gap +
    // 12px gray text; product/usecase stay filter-only (hidden data attrs).
    // Posts with no CMS category on claude.com render an empty tag row.
    const category = facetValues(a, 'category')[0] || '';
    const tagNodes = category
      ? `${categoryIcon(category)}<div class="u-text-style-caption">${htmlEscape(category)}</div>`
      : '<div class="u-text-style-caption"></div>';
    return `        <article class="grid-card card_blog_wrap" data-category="${facetDataAttr(a, 'category')}" data-product="${facetDataAttr(a, 'product')}" data-usecase="${facetDataAttr(a, 'usecase')}" data-date="${iso}" data-title="${htmlEscape(title)}">
          <div class="grid-card-visual card_blog_visual_wrap" style="background-color: var(${illoVar(a.illustrationBg)});">
            ${illo}
          </div>
          <div class="grid-card-content card_blog_content">
            ${dateNode.trim()}
            <h2 class="grid-card-title u-text-style-h6">${htmlEscape(title)}${langBadge}</h2>
            <div class="card-main_tag-wrap">
              ${tagNodes}
            </div>
          </div>
          <a class="clickable-link" href="${articleLink(a, hasZh)}"${isExternalLink(a, hasZh) ? ' target="_blank" rel="noopener noreferrer"' : ''} aria-label="${htmlEscape(title)}"></a>
        </article>`;
  }).join('\n');
}

function byDateDesc(a, b) {
  const da = parseDate(a.date);
  const db = parseDate(b.date);
  if (da && db) return db.getTime() - da.getTime();
  if (da) return -1;
  if (db) return 1;
  return 0;
}

function selectHero(articles) {
  const flagged = articles.filter(a => a.inHero === true);
  if (flagged.length > 0) {
    return flagged.sort((a, b) => (a.heroIndex || 0) - (b.heroIndex || 0));
  }
  // Fallback for legacy index.json without hero flags.
  return articles.slice(0, Math.min(10, articles.length));
}

function selectGrid(articles) {
  const flagged = articles.filter(a => a.inGrid === true);
  if (flagged.length > 0 || articles.some(a => a.inGrid === false)) {
    return flagged.sort(byDateDesc);
  }
  // Fallback for legacy index.json without grid flags.
  return articles.slice().sort(byDateDesc);
}

// Client-side multi-facet checkbox filtering + sort + search + "View more".
// Filter semantics follow the official Finsweet List setup: selected values
// within one facet combine with OR, different facets combine with AND.
const HOME_JS = `  <script>
    (function () {
      var PAGE = 15;
      var grid = document.querySelector('.blog-grid');
      if (!grid) return;
      var allCards = Array.prototype.slice.call(grid.querySelectorAll('.grid-card'));
      var btn = document.querySelector('.view-more-btn');
      var sortSelect = document.getElementById('blog-sort');
      var state = { facets: { category: [], product: [], usecase: [] }, sort: 'date-desc', page: PAGE };

      function readFacets() {
        ['category', 'product', 'usecase'].forEach(function (f) {
          var checked = document.querySelectorAll('input[type="checkbox"][data-facet="' + f + '"]:checked');
          state.facets[f] = Array.prototype.map.call(checked, function (c) { return c.value; });
        });
      }
      function valuesOf(card, field) {
        var raw = card.getAttribute('data-' + field) || '';
        return raw ? raw.split('|') : [];
      }
      function matches(card) {
        for (var f in state.facets) {
          var sel = state.facets[f];
          if (!sel.length) continue;
          var vals = valuesOf(card, f);
          var hit = false;
          for (var i = 0; i < sel.length; i++) {
            if (vals.indexOf(sel[i]) !== -1) { hit = true; break; }
          }
          if (!hit) return false; /* AND across facets */
        }
        return true;
      }
      function apply() {
        var vis = allCards.filter(matches).sort(function (a, b) {
          var da = a.getAttribute('data-date') || '', db = b.getAttribute('data-date') || '';
          if (state.sort === 'heading-asc') return (a.getAttribute('data-title') || '').localeCompare(b.getAttribute('data-title') || '', 'zh-Hans-CN');
          if (state.sort === 'heading-desc') return (b.getAttribute('data-title') || '').localeCompare(a.getAttribute('data-title') || '', 'zh-Hans-CN');
          return da > db ? -1 : da < db ? 1 : 0; /* date-desc = Newest */
        });
        vis.forEach(function (c) { grid.appendChild(c); });
        vis.forEach(function (c, i) { c.classList.toggle('is-hidden', i >= state.page); });
        allCards.forEach(function (c) { if (vis.indexOf(c) === -1) c.classList.add('is-hidden'); });
        if (btn) btn.style.display = vis.length > state.page ? '' : 'none';
      }

      /* Filter checkboxes: immediate filtering (official desktop sidebar has
         no Apply button). */
      document.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.type === 'checkbox' && t.getAttribute('data-facet')) {
          readFacets(); state.page = PAGE; apply();
        }
      });
      if (sortSelect) sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; apply(); });
      if (btn) btn.addEventListener('click', function () { state.page += PAGE; apply(); });

      /* Accordion groups: default all collapsed (data-open-by-default="0"),
         multiple groups may stay open (data-close-previous="false"). */
      Array.prototype.forEach.call(document.querySelectorAll('[data-accordion="component"]'), function (comp) {
        var toggle = comp.querySelector('[data-accordion="toggle"]');
        if (!toggle) return;
        toggle.addEventListener('click', function () {
          var opened = comp.classList.toggle('is-opened');
          toggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
        });
      });

      /* Grid/List view toggle */
      var toggleBtns = Array.prototype.slice.call(document.querySelectorAll('.view-toggle-btn'));
      toggleBtns.forEach(function (b) {
        b.addEventListener('click', function () {
          toggleBtns.forEach(function (x) { x.classList.toggle('is-active', x === b); });
          if (grid) grid.classList.toggle('is-list', b.getAttribute('data-view') === 'list');
        });
      });
      /* Hero category items: toggle the matching sidebar checkbox + filter. */
      Array.prototype.forEach.call(document.querySelectorAll('.hero_cat-item'), function (it) {
        it.addEventListener('click', function (e) {
          e.preventDefault();
          var cat = it.getAttribute('data-filter-cat');
          var cb = document.querySelector('input[type="checkbox"][data-facet="category"][value="' + cat + '"]');
          if (cb) { cb.checked = !cb.checked; readFacets(); state.page = PAGE; apply(); }
          var g = document.getElementById('grid');
          if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      readFacets();
      apply();
    })();
  </script>`;

// Official checkbox row (spec 2.5): 1.25rem box with check svg, 15px label.
function checkboxItem(facet, value) {
  return `                <div role="listitem" class="form_main_item">
                  <label class="form_main_checkbox_label">
                    <input type="checkbox" name="${facet}" value="${htmlEscape(value)}" data-facet="${facet}" class="form_main_checkbox_input"/>
                    <span class="form_main_checkbox_box">
                      <svg viewBox="0 0 11 8" fill="none" aria-hidden="true" class="form_main_checkbox_icon">
                        <path d="M1 4L4 7L10 1" stroke="currentColor" vector-effect="non-scaling-stroke" stroke-width="0.125rem"/>
                      </svg>
                    </span>
                    <span class="form_main_checkbox_text u-text-style-body-3">${htmlEscape(value)}</span>
                  </label>
                </div>`;
}

// Official accordion group (spec 2.3): border-top separator, caption-size
// group title + chevron, collapsible menu; default collapsed.
function facetGroup(title, field, options) {
  const items = options.map(v => checkboxItem(field, v)).join('\n');
  return `            <div data-accordion="component" role="listitem" class="stories_filters_dropdown_wrap">
              <button aria-expanded="false" data-accordion="toggle" type="button" class="stories_filters_dropdown_toggle">
                <span class="stories_filters_dropdown_text u-text-style-caption u-foreground-tertiary">${htmlEscape(title)}</span>
                <div data-accordion="icon" class="stories_filters_dropdown_icon is-mobile">
                  <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="u-svg"><path d="${CHEVRON_ICON_PATH}" fill="currentColor"/></svg>
                </div>
              </button>
              <div data-accordion="content" class="stories_filters_dropdown_menu">
                <div class="stories_filters_dropdown_inner">
${items}
                </div>
              </div>
            </div>`;
}

// Sort-by accordion group (spec 2.4): desktop sidebar uses a <select> with
// the three official sort options; default = Newest (date-desc).
function sortGroup() {
  return `            <div data-accordion="component" role="listitem" class="stories_filters_dropdown_wrap">
              <button aria-expanded="false" data-accordion="toggle" type="button" class="stories_filters_dropdown_toggle">
                <span class="stories_filters_dropdown_text u-text-style-caption u-foreground-tertiary">Sort by</span>
                <div data-accordion="icon" class="stories_filters_dropdown_icon is-mobile">
                  <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="u-svg"><path d="${CHEVRON_ICON_PATH}" fill="currentColor"/></svg>
                </div>
              </button>
              <div data-accordion="content" class="stories_filters_dropdown_menu">
                <div class="stories_filters_dropdown_inner">
                  <label class="form_main_label_wrap">
                    <span class="u-sr-only">Sort by</span>
                    <span class="form_main_select_wrap">
                      <select id="blog-sort" name="Sort" class="form_main_field u-theme-white">
                        <option value="date-desc">Newest</option>
                        <option value="heading-asc">Alphabetically (A to Z)</option>
                        <option value="heading-desc">Alphabetically (Z to A)</option>
                      </select>
                      <div class="form_main_select_icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="u-svg"><path d="${CHEVRON_ICON_PATH}" fill="currentColor"/></svg>
                      </div>
                    </span>
                  </label>
                </div>
              </div>
            </div>`;
}

// Official sidebar filter form (spec 2.1–2.5): "Filter and sort" heading +
// four accordion groups, all collapsed by default, immediate filtering.
function sidebarSection(articles) {
  const categoryOptions = facetOptions(articles, 'category');
  const productOptions = facetOptions(articles, 'product');
  const usecaseOptions = facetOptions(articles, 'usecase');
  return `        <aside class="blog-sidebar usecase_filters">
          <div class="blog_filters_wrap">
            <form data-close-previous="false" data-close-on-second-click="true" data-open-on-hover="false" data-open-by-default="0" data-accordion="wrap" class="blog_filters_form">
              <div class="blog_filters_heading u-text-style-body-3 u-mb-0-75">Filter and sort</div>
              <div class="accordion_list">
${sortGroup()}
${facetGroup('Category', 'category', categoryOptions)}
${facetGroup('Product', 'product', productOptions)}
${facetGroup('Use case', 'usecase', usecaseOptions)}
              </div>
            </form>
          </div>
        </aside>`;
}

// Main toolbar: Grid/List view tabs (search removed per request).
function toolbarSection() {
  return `          <div class="blog_main_toolbar">
            <div class="tab_menu_inner view-toggle" role="group" aria-label="视图切换">
              <button class="view-toggle-btn tab_btn_wrap is-active" data-view="grid" type="button" aria-label="Grid">
                <span class="tab_btn_text u-text-style-caption">Grid</span>
              </button>
              <button class="view-toggle-btn tab_btn_wrap" data-view="list" type="button" aria-label="List">
                <span class="tab_btn_text u-text-style-caption">List</span>
              </button>
            </div>
          </div>`;
}

function heroBlogSection(articles) {
  const CATS = ['Agents', 'Claude Code', 'Enterprise AI', 'Product announcements'];
  const count = (c) => articles.filter(a => {
    const cats = (a.facets && a.facets.category && a.facets.category.length) ? a.facets.category : (a.category ? [a.category] : []);
    return cats.indexOf(c) !== -1;
  }).length;
  const total = articles.length;
  const items = CATS.map((c, i) => `          <a class="hero_cat-item" data-filter-cat="${c}" href="#grid">
            <span class="hero_cat-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="hero_cat-name">${c}</span>
            <span class="hero_cat-count">${count(c)}</span>
            <span class="hero_cat-arrow" aria-hidden="true">→</span>
          </a>`).join('\n');
  return `  <section class="hero_blog_wrap">
    <div class="container">
      <div class="hero_blog_layout">
        <div class="hero_blog_desc">
          <h1 class="hero_blog_heading">Blog</h1>
          <p class="hero_blog_text">产品动态，以及团队使用 Claude 的最佳实践。</p>
          <a class="hero_cta" href="https://claude.ai" target="_blank" rel="noopener noreferrer">试用 Claude</a>
        </div>
        <div class="hero_blog_cats">
          <div class="hero_blog_cats_head"><span>全部文章</span><span>${total}</span></div>
          <div class="hero_cat_list">
${items}
          </div>
        </div>
      </div>
    </div>
  </section>

`;
}

function buildIndex(meta) {
  const articles = meta.articles || [];
  const hero = selectHero(articles);
  const grid = selectGrid(articles);

  const heroBlog = heroBlogSection(articles);
  const marquee = marqueeSection(hero);

  const gridSection = grid.length > 0
    ? `  <section class="grid-section" id="grid">
    <div class="container">
      <div class="section-head">
        <h2>全部文章</h2>
      </div>
      <div class="blog-layout">
${sidebarSection(articles)}
        <div class="blog-main usecase_content">
${toolbarSection()}
          <div class="blog-grid">
${gridCards(grid)}
          </div>
          <div class="grid-foot">
            <button class="view-more-btn" type="button">View more</button>
          </div>
        </div>
      </div>
    </div>
  </section>`
    : '';

  const body = `<main class="main">
${heroBlog}${marquee}${gridSection}
</main>`;

  return renderPage({
    lang: 'zh-CN',
    title: 'Claude Blog 中文翻译',
    description: 'Claude by Anthropic 官方博客的中文翻译镜像站，定时同步更新。',
    body,
    headExtra: '',
    navLinks: HOME_NAV,
    footerVariant: 'zh-home',
    meta,
    bodyExtra: HOME_JS,
  });
}

/* ===== Article pages ===== */

function readContent(file) {
  let contentHtml = '';
  if (fs.existsSync(file)) {
    contentHtml = fs.readFileSync(file, 'utf-8');
  }
  return contentHtml
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/g, '<br>');
}

function buildArticlePage(article, hasTranslation, meta) {
  const contentHtml = hasTranslation
    ? readContent(path.join(ZH_DIR, article.slug, 'content.html'))
    : readContent(path.join(EN_DIR, article.slug, 'content.html'));
  const title = hasTranslation && article.translatedTitle ? article.translatedTitle : article.title;

  const langLabel = hasTranslation ? '' : '<span class="lang-badge-large">EN</span>';
  const langToggle = hasTranslation
    ? `<a href="${BASE_PATH}/posts/${article.slug}/en.html" class="lang-toggle">阅读英文原文 →</a>`
    : '';

  const body = `<main class="main">
    <div class="container article-container">
      <article class="article">
        <header class="article-header">
          <div class="article-meta">
            <span class="tag">${htmlEscape(article.category)}</span>
            <span class="article-date">${htmlEscape(article.date)}</span>
            ${langLabel}
          </div>
          <h1 class="article-title">${htmlEscape(title)}</h1>
          ${langToggle}
        </header>
        <div class="article-content u-rich-text">
          ${contentHtml}
        </div>
        <footer class="article-footer">
          <hr>
          <p><a href="https://claude.com/blog/${article.slug}" target="_blank">查看原文</a> · 翻译由 AI 生成，如有不准确之处请以原文为准</p>
          <p><a href="${BASE_PATH}/">← 返回首页</a></p>
        </footer>
      </article>
    </div>
  </main>`;

  return renderPage({
    lang: 'zh-CN',
    title: `${title} — Claude Blog 中文翻译`,
    description: title,
    body,
    navLinks: articleNav(article),
    footerVariant: 'zh',
    meta,
  });
}

function buildEnglishPage(article, meta) {
  const contentHtml = readContent(path.join(EN_DIR, article.slug, 'content.html'));

  const body = `<main class="main">
    <div class="container article-container">
      <article class="article">
        <header class="article-header">
          <div class="article-meta">
            <span class="tag">${htmlEscape(article.category)}</span>
            <span class="article-date">${htmlEscape(article.date)}</span>
            <span class="lang-badge-large">EN</span>
          </div>
          <h1 class="article-title">${htmlEscape(article.title)}</h1>
          <a href="${BASE_PATH}/posts/${article.slug}/" class="lang-toggle">阅读中文翻译 →</a>
        </header>
        <div class="article-content u-rich-text">
          ${contentHtml}
        </div>
        <footer class="article-footer">
          <hr>
          <p><a href="https://claude.com/blog/${article.slug}" target="_blank">View original</a></p>
          <p><a href="${BASE_PATH}/">← Back to home</a></p>
        </footer>
      </article>
    </div>
  </main>`;

  return renderPage({
    lang: 'en',
    title: `${article.title} — Claude Blog CN`,
    description: article.title,
    body,
    navLinks: [
      { href: `${BASE_PATH}/`, label: '首页' },
      { href: `${BASE_PATH}/posts/${article.slug}/`, label: '中文版 →' },
    ],
    footerVariant: 'en',
    meta,
  });
}

/* ===== RSS ===== */

function buildRSS(meta) {
  const articles = meta.articles || [];
  const items = articles.map(a => {
    const hasZh = hasZhContent(a);
    const title = articleTitle(a, hasZh);
    const link = hasZh
      ? `${SITE_URL}/posts/${a.slug}/`
      : (hasEnContent(a) ? `${SITE_URL}/posts/${a.slug}/en.html` : (a.url || `${SITE_URL}/posts/${a.slug}/`));
    return `    <item>
      <title>${htmlEscape(title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${rssPubDate(a)}</pubDate>
      <category>${htmlEscape(a.category)}</category>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Claude Blog 中文翻译</title>
    <link>${SITE_URL}</link>
    <description>Anthropic Claude 官方博客的中文翻译</description>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

/* ===== Main ===== */

async function main() {
  if (!fs.existsSync(META_FILE)) {
    console.error(`Metadata file not found: ${META_FILE}. Run "npm run fetch" first (or set INDEX_FILE).`);
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  const articles = meta.articles || [];

  if (!fs.existsSync(SITE_DIR)) {
    fs.mkdirSync(SITE_DIR, { recursive: true });
  }

  console.log(`Building site for ${articles.length} articles -> ${SITE_DIR}`);

  // Index
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), buildIndex(meta), 'utf-8');
  console.log('  ✓ index.html');

  // RSS
  fs.writeFileSync(path.join(SITE_DIR, 'rss.xml'), buildRSS(meta), 'utf-8');
  console.log('  ✓ rss.xml');

  // Article pages
  let pageCount = 0;
  for (const article of articles) {
    const hasZh = hasZhContent(article);
    const postDir = path.join(SITE_DIR, 'posts', article.slug);
    fs.mkdirSync(postDir, { recursive: true });

    if (hasZh) {
      fs.writeFileSync(path.join(postDir, 'index.html'), buildArticlePage(article, true, meta), 'utf-8');
      pageCount++;
    }

    if (fs.existsSync(path.join(EN_DIR, article.slug, 'content.html'))) {
      fs.writeFileSync(path.join(postDir, 'en.html'), buildEnglishPage(article, meta), 'utf-8');
      pageCount++;
    }
  }

  console.log(`  ✓ ${pageCount} article pages`);
  console.log('Done!');
}

main().catch(console.error);
