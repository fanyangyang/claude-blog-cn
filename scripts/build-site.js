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
 *   subtitle: string       - English hero subtitle / meta description
 *   translatedSubtitle: string - optional Chinese subtitle
 *   authors: string[]      - hero Author(s) list
 *   readingMinutes: number - official reading time in minutes
 *   categoryUrl / productUrl: string - official detail-link hrefs
 *   facets: { category, product, usecase }
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
 * Pass headerHtml to replace the default site header (article pages use the
 * official-style breadcrumb + Explore here topbar instead).
 */
function renderPage({ lang, title, description, body, headExtra = '', navLinks, footerVariant, meta = null, bodyExtra = '', headerHtml }) {
  const header = headerHtml !== undefined ? headerHtml : renderHeader(navLinks || []);
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
${header}
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

// Official hero category arrow (hero_blog_list_item_arrow svg).
const HERO_ARROW_PATH = 'M11.1465 4.64648C11.3417 4.45127 11.6582 4.45136 11.8535 4.64648L16.8535 9.64649L16.916 9.72267C16.9703 9.80418 17 9.90061 17 10C17 10.1326 16.9473 10.2598 16.8535 10.3535L11.8535 15.3535C11.6583 15.5486 11.3417 15.5487 11.1465 15.3535C10.9513 15.1583 10.9514 14.8418 11.1465 14.6465L15.293 10.5H3.5C3.2239 10.5 3.00006 10.2761 3 10C3 9.72387 3.22386 9.50001 3.5 9.50001H15.293L11.1465 5.35352C10.9514 5.15826 10.9513 4.8417 11.1465 4.64648Z';

// Official Grid/List view-toggle icons (tab_btn_icon svg, viewBox 0 0 18 18).
const GRID_ICON_PATH = 'M6.3125 10.1875C7.14093 10.1875 7.8125 10.8591 7.8125 11.6875V14.1875C7.8125 15.0159 7.14093 15.6875 6.3125 15.6875H3.8125C2.98407 15.6875 2.3125 15.0159 2.3125 14.1875V11.6875C2.3125 10.8591 2.98407 10.1875 3.8125 10.1875H6.3125ZM14.1875 10.1875C15.0159 10.1875 15.6875 10.8591 15.6875 11.6875V14.1875C15.6875 15.0159 15.0159 15.6875 14.1875 15.6875H11.6875C10.8591 15.6875 10.1875 15.0159 10.1875 14.1875V11.6875C10.1875 10.8591 10.8591 10.1875 11.6875 10.1875H14.1875ZM3.8125 11.1875C3.53636 11.1875 3.3125 11.4114 3.3125 11.6875V14.1875C3.3125 14.4636 3.53636 14.6875 3.8125 14.6875H6.3125C6.58864 14.6875 6.8125 14.4636 6.8125 14.1875V11.6875C6.8125 11.4114 6.58864 11.1875 6.3125 11.1875H3.8125ZM11.6875 11.1875C11.4114 11.1875 11.1875 11.4114 11.1875 11.6875V14.1875C11.1875 14.4636 11.4114 14.6875 11.6875 14.6875H14.1875C14.4636 14.6875 14.6875 14.4636 14.6875 14.1875V11.6875C14.6875 11.4114 14.4636 11.1875 14.1875 11.1875H11.6875ZM6.3125 2.3125C7.14093 2.3125 7.8125 2.98407 7.8125 3.8125V6.3125C7.8125 7.14093 7.14093 7.8125 6.3125 7.8125H3.8125C2.98407 7.8125 2.3125 7.14093 2.3125 6.3125V3.8125C2.3125 2.98407 2.98407 2.3125 3.8125 2.3125H6.3125ZM14.1875 2.3125C15.0159 2.3125 15.6875 2.98407 15.6875 3.8125V6.3125C15.6875 7.14093 15.0159 7.8125 14.1875 7.8125H11.6875C10.8591 7.8125 10.1875 7.14093 10.1875 6.3125V3.8125C10.1875 2.98407 10.8591 2.3125 11.6875 2.3125H14.1875ZM3.8125 3.3125C3.53636 3.3125 3.3125 3.53636 3.3125 3.8125V6.3125C3.3125 6.58864 3.53636 6.8125 3.8125 6.8125H6.3125C6.58864 6.8125 6.8125 6.58864 6.8125 6.3125V3.8125C6.8125 3.53636 6.58864 3.3125 6.3125 3.3125H3.8125ZM11.6875 3.3125C11.4114 3.3125 11.1875 3.53636 11.1875 3.8125V6.3125C11.1875 6.58864 11.4114 6.8125 11.6875 6.8125H14.1875C14.4636 6.8125 14.6875 6.58864 14.6875 6.3125V3.8125C14.6875 3.53636 14.4636 3.3125 14.1875 3.3125H11.6875Z';
const LIST_ICON_PATH = 'M3.82422 12.825C4.44554 12.825 4.94922 13.3287 4.94922 13.95C4.94922 14.5714 4.44554 15.075 3.82422 15.075C3.2029 15.075 2.69922 14.5714 2.69922 13.95C2.69922 13.3287 3.2029 12.825 3.82422 12.825ZM14.8492 13.5C15.0977 13.5 15.2992 13.7015 15.2992 13.95C15.2992 14.1986 15.0977 14.4 14.8492 14.4H7.64922C7.40069 14.4 7.19922 14.1986 7.19922 13.95C7.19922 13.7015 7.40069 13.5 7.64922 13.5H14.8492ZM3.82422 7.87505C4.44554 7.87505 4.94922 8.37873 4.94922 9.00005C4.94922 9.62137 4.44554 10.125 3.82422 10.125C3.2029 10.125 2.69922 9.62137 2.69922 9.00005C2.69922 8.37873 3.2029 7.87505 3.82422 7.87505ZM14.8492 8.55005C15.0977 8.55005 15.2992 8.75152 15.2992 9.00005C15.2992 9.24858 15.0977 9.45005 14.8492 9.45005H7.64922C7.40069 9.45005 7.19922 9.24858 7.19922 9.00005C7.19922 8.75152 7.40069 8.55005 7.64922 8.55005H14.8492ZM3.82422 2.92505C4.44554 2.92505 4.94922 3.42873 4.94922 4.05005C4.94922 4.67137 4.44554 5.17505 3.82422 5.17505C3.2029 5.17505 2.69922 4.67137 2.69922 4.05005C2.69922 3.42873 3.2029 2.92505 3.82422 2.92505ZM14.8492 3.60005C15.0977 3.60005 15.2992 3.80152 15.2992 4.05005C15.2992 4.29858 15.0977 4.50005 14.8492 4.50005H7.64922C7.40069 4.50005 7.19922 4.29858 7.19922 4.05005C7.19922 3.80152 7.40069 3.60005 7.64922 3.60005H14.8492Z';

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

// List-view column header (hidden in grid mode, shown in list mode).
function listHeader() {
  return `        <div class="list-header">
          <span class="list-header-title"></span>
          <span class="list-header-col">Category</span>
          <span class="list-header-col">Product</span>
          <span class="list-header-col">Usecase</span>
        </div>`;
}

function gridCards(articles) {
  return articles.map((a) => {
    const hasZh = hasZhContent(a);
    const title = articleTitle(a, hasZh);
    const langBadge = hasZh ? '' : '<span class="lang-badge">EN</span>';
    const shortDate = toShortDate(a.date);
    // Official card date: "Aug 28, 2026" (three-letter month, spec appendix).
    const dateNode = shortDate
      ? `<div class="u-text-style-caption u-foreground-tertiary u-mb-1-5">${shortDate}</div>\n            `
      : '';
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
    // List-view columns: category, product, usecase (hidden in grid, visible
    // in list mode). Multiple values are comma-separated.
    const productText = facetValues(a, 'product').join(', ');
    const usecaseText = facetValues(a, 'usecase').join(', ');
    return `        <article class="grid-card card_blog_wrap" data-category="${facetDataAttr(a, 'category')}" data-product="${facetDataAttr(a, 'product')}" data-usecase="${facetDataAttr(a, 'usecase')}" data-date="${iso}" data-title="${htmlEscape(title)}">
          <div class="grid-card-visual card_blog_visual_wrap" style="background-color: var(${illoVar(a.illustrationBg)});">
            ${illo}
          </div>
          <div class="grid-card-content card_blog_content">
            <div class="grid-card-copy">
            ${dateNode}<h2 class="grid-card-title u-text-style-h6">${htmlEscape(title)}${langBadge}</h2>
            </div>
            <div class="card-main_tag-wrap">
              ${tagNodes}
            </div>
          </div>
          <span class="list-col list-col-category">${htmlEscape(category)}</span>
          <span class="list-col list-col-product">${htmlEscape(productText)}</span>
          <span class="list-col list-col-usecase">${htmlEscape(usecaseText)}</span>
          <div class="clickable_wrap u-cover-absolute">
            <a class="clickable_link" href="${articleLink(a, hasZh)}"${isExternalLink(a, hasZh) ? ' target="_blank" rel="noopener noreferrer"' : ''} aria-label="${htmlEscape(title)}"><span class="u-sr-only">阅读</span></a>
          </div>
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

      /* Accordion groups: default all expanded (is-opened on render), multiple
         groups may stay open (data-close-previous="false"). Click toggles. */
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
      readFacets();
      apply();
    })();
    /* Card scroll-in entrance — progressive enhancement. Hidden only when
       JS is active (body.js-anim); IntersectionObserver reveals on scroll.
       No JS = cards visible immediately (no invisible-content risk). */
    (function () {
      try {
        document.body.classList.add('js-anim');
        var cards = document.querySelectorAll('.grid-card');
        if (!('IntersectionObserver' in window)) {
          cards.forEach(function (c) { c.classList.add('is-visible'); });
          return;
        }
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
          });
        }, { rootMargin: '0px 0px -10% 0px' });
        cards.forEach(function (c) { io.observe(c); });
      } catch (e) {
        document.querySelectorAll('.grid-card').forEach(function (c) { c.classList.add('is-visible'); });
      }
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
            <div data-tabs="menu" role="tablist" class="tab_menu_inner view-toggle">
              <button class="view-toggle-btn tab_btn_wrap is-active" data-view="grid" type="button" role="tab" aria-label="Grid">
                <span class="tab_btn_icon"><svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 18 18" fill="none" class="u-svg"><path d="${GRID_ICON_PATH}" fill="currentColor"/></svg></span>
                <span class="tab_btn_text u-text-style-caption">Grid</span>
              </button>
              <button class="view-toggle-btn tab_btn_wrap" data-view="list" type="button" role="tab" aria-label="List">
                <span class="tab_btn_icon"><svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 18 18" fill="none" class="u-svg"><path d="${LIST_ICON_PATH}" fill="currentColor"/></svg></span>
                <span class="tab_btn_text u-text-style-caption">List</span>
              </button>
            </div>
          </div>`;
}

function heroBlogSection(articles) {
  // 1:1 with the official hero right column (hero_blog_list): each item is a
  // big h1 category title + arrow, linking to the official /blog-category page
  // (this mirror has no local category page). No number/count/head row.
  const CATS = [
    { name: 'Agents', slug: 'agents' },
    { name: 'Claude Code', slug: 'claude-code' },
    { name: 'Enterprise AI', slug: 'enterprise-ai' },
    { name: 'Product announcements', slug: 'announcements' },
  ];
  const items = CATS.map(c => `          <a class="hero_blog_list_item" href="https://claude.com/blog-category/${c.slug}" target="_blank" rel="noopener noreferrer">
            <div class="hero_blog_list_item_content">
              <h2 class="hero_blog_list_item_title u-text-style-h1">${c.name}<span class="hero_blog_list_item_arrow" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 20 20" fill="none" class="u-svg"><path d="${HERO_ARROW_PATH}" fill="currentColor"/></svg></span></h2>
            </div>
          </a>`).join('\n');
  return `  <section class="hero_blog_wrap">
    <div class="u-section-spacer is-page-top" aria-hidden="true"></div>
    <div class="container">
      <div class="hero_blog_layout">
        <div class="hero_blog_desc">
          <div class="hero_blog_desc_top">
            <h1 class="hero_blog_heading u-text-style-body-1 u-weight-semibold">Blog</h1>
          </div>
          <div class="hero_blog_desc_bottom">
            <p class="hero_blog_text u-text-style-body-2">产品动态，以及团队使用 Claude 的最佳实践。</p>
            <a class="hero_cta" href="https://claude.ai" target="_blank" rel="noopener noreferrer">试用 Claude</a>
          </div>
        </div>
        <div class="hero_blog_content">
          <div class="hero_blog_list_wrap">
            <div role="list" class="hero_blog_list">
${items}
            </div>
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
  const spacer = `  <div class="u-section-spacer is-main" aria-hidden="true"></div>\n`;

  const gridSection = grid.length > 0
    ? `  <section class="grid-section" id="grid">
    <div class="container">
      <div class="blog-layout">
${sidebarSection(articles)}
        <div class="blog-main usecase_content">
${toolbarSection()}
          <div class="blog-grid">
${listHeader()}
${gridCards(grid)}
          </div>
          <div class="grid-foot">
            <button class="view-more-btn" type="button">View more</button>
          </div>
        </div>
      </div>
    </div>
  </section>
  <div class="u-section-spacer is-main" aria-hidden="true"></div>`
    : '';

  const body = `<main class="main">
${heroBlog}${spacer}${marquee}${marquee ? spacer : ''}${gridSection}
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

// Rough HTML → markdown for the Explore-here "Copy as markdown" action.
function htmlToMarkdown(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n\n');
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n\n');
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n\n');
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n\n');
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

const DETAIL_ICONS = {
  category: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 17C12.7761 17 13 17.2239 13 17.5C13 17.7761 12.7761 18 12.5 18H7.5C7.22386 18 7 17.7761 7 17.5C7 17.2239 7.22386 17 7.5 17H12.5ZM10 2C13.3137 2 16 4.68629 16 8C16 9.73776 15.2608 11.3033 14.0811 12.3984L13.8389 12.6113C13.3268 13.0382 13 13.5753 13 14.124V15.5C13 15.7761 12.7761 16 12.5 16H7.5C7.22386 16 7 15.7761 7 15.5V14.124C6.99998 13.6438 6.7495 13.1727 6.34375 12.7764L6.16113 12.6113C4.84147 11.5115 4 9.85368 4 8C4 4.68629 6.68629 2 10 2ZM10 3C7.23858 3 5 5.23858 5 8C5 9.5443 5.69948 10.9248 6.80078 11.8428L7.03711 12.0557C7.57356 12.5787 7.99998 13.2899 8 14.124V15H9.5V11.207L7.14648 8.85352L7.08203 8.77539C6.95387 8.58131 6.97562 8.31735 7.14648 8.14648C7.31735 7.97562 7.58131 7.95387 7.77539 8.08203L7.85352 8.14648L10 10.293L12.1465 8.14648L12.2246 8.08203C12.4187 7.95387 12.6827 7.97562 12.8535 8.14648C13.0244 8.31735 13.0461 8.58131 12.918 8.77539L12.8535 8.85352L10.5 11.207V15H12V14.124C12 13.1706 12.5575 12.3776 13.1992 11.8428L13.4004 11.665C14.3848 10.7513 15 9.44786 15 8C15 5.23858 12.7614 3 10 3Z" fill="currentColor"></path></svg>',
  product: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 3C13.3284 3 14 3.67157 14 4.5V6H14.5C16.433 6 18 7.567 18 9.5V15.5C18 16.3284 17.3284 17 16.5 17H3.5C2.72334 17 2.08461 16.4097 2.00781 15.6533L2 15.5V9.5C2 7.567 3.567 6 5.5 6H6V4.5C6 3.67157 6.67157 3 7.5 3H12.5ZM3 15.5L3.00977 15.6006C3.05629 15.8286 3.25829 16 3.5 16H16.5C16.7761 16 17 15.7761 17 15.5V12H13V12.5C13 12.7761 12.7761 13 12.5 13C12.2239 13 12 12.7761 12 12.5V12H8V12.5C8 12.7761 7.77614 13 7.5 13C7.22386 13 7 12.7761 7 12.5V12H3V15.5ZM5.5 7C4.11929 7 3 8.11929 3 9.5V11H7V10.5C7 10.2239 7.22386 10 7.5 10C7.77614 10 8 10.2239 8 10.5V11H12V10.5C12 10.2239 12.2239 10 12.5 10C12.7761 10 13 10.2239 13 10.5V11H17V9.5C17 8.11929 15.8807 7 14.5 7H5.5ZM7.5 4C7.22386 4 7 4.22386 7 4.5V6H13V4.5C13 4.22386 12.7761 4 12.5 4H7.5Z" fill="currentColor"></path></svg>',
  date: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13.5 3C13.7761 3 14 3.22386 14 3.5V4H16.5C17.3284 4 18 4.67157 18 5.5V14.5C18 15.3284 17.3284 16 16.5 16H3.5C2.67157 16 2 15.3284 2 14.5V5.5C2 4.67157 2.67157 4 3.5 4H6V3.5C6 3.22386 6.22386 3 6.5 3C6.77614 3 7 3.22386 7 3.5V4H13V3.5C13 3.22386 13.2239 3 13.5 3ZM3.5 5C3.22386 5 3 5.22386 3 5.5V14.5C3 14.7761 3.22386 15 3.5 15H16.5C16.7761 15 17 14.7761 17 14.5V5.5C17 5.22386 16.7761 5 16.5 5H14V5.5C14 5.77614 13.7761 6 13.5 6C13.2239 6 13 5.77614 13 5.5V5H7V5.5C7 5.77614 6.77614 6 6.5 6C6.22386 6 6 5.77614 6 5.5V5H3.5ZM13.1162 8.17969C13.293 7.96781 13.6083 7.93951 13.8203 8.11621C14.0322 8.29304 14.0605 8.60827 13.8838 8.82031L11.3838 11.8203C11.2939 11.9281 11.1627 11.9927 11.0225 11.999C10.8822 12.0053 10.7458 11.9528 10.6465 11.8535L9.0332 10.2402L6.88379 12.8203C6.70696 13.0322 6.39173 13.0605 6.17969 12.8838C5.96781 12.707 5.93951 12.3917 6.11621 12.1797L8.61621 9.17969L8.69043 9.10742C8.77188 9.0432 8.87221 9.00575 8.97754 9.00098C9.11781 8.99466 9.25422 9.04719 9.35352 9.14648L10.9658 10.7588L13.1162 8.17969Z" fill="currentColor"></path></svg>',
  reading: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M11.5 2C11.7761 2 12 2.22386 12 2.5C12 2.77614 11.7761 3 11.5 3H10.5V4.01953C12.0566 4.12942 13.4719 4.74753 14.582 5.70996L15.3037 4.98926C15.499 4.79436 15.8156 4.79412 16.0107 4.98926C16.2059 5.1844 16.2056 5.501 16.0107 5.69629L15.2891 6.41699C16.3542 7.64511 17 9.24674 17 11C17 14.866 13.866 18 10 18C6.13401 18 3 14.866 3 11C3 7.30217 5.86743 4.27597 9.5 4.01953V3H8.5C8.22386 3 8 2.77614 8 2.5C8 2.22386 8.22386 2 8.5 2H11.5ZM10 5C6.68629 5 4 7.68629 4 11C4 14.3137 6.68629 17 10 17C13.3137 17 16 14.3137 16 11C16 7.68629 13.3137 5 10 5ZM7.17188 8.17188C7.29007 8.05368 7.45914 8.0024 7.62305 8.03516H7.62695C7.62846 8.03541 7.63045 8.03566 7.63281 8.03613C7.63847 8.03729 7.64687 8.03982 7.65723 8.04199C7.67822 8.04638 7.70875 8.05315 7.74707 8.06152C7.82438 8.07842 7.93535 8.10307 8.07031 8.13574C8.34023 8.20109 8.7112 8.29808 9.11133 8.42383C9.51008 8.54915 9.94691 8.70603 10.3467 8.89258C10.7387 9.07552 11.132 9.30384 11.4141 9.58594C12.1951 10.367 12.1951 11.633 11.4141 12.4141C10.633 13.1951 9.36699 13.1951 8.58594 12.4141C8.30384 12.132 8.07552 11.7387 7.89258 11.3467C7.70603 10.9469 7.54915 10.5101 7.42383 10.1113C7.29808 9.7112 7.20109 9.34023 7.13574 9.07031C7.10307 8.93535 7.07842 8.82438 7.06152 8.74707C7.05315 8.70876 7.04638 8.67822 7.04199 8.65723C7.03982 8.64687 7.03729 8.63847 7.03613 8.63281C7.03566 8.63045 7.03541 8.62846 7.03516 8.62695V8.62305L7.02637 8.56055C7.01616 8.41702 7.06868 8.27507 7.17188 8.17188ZM8.37793 9.81152C8.49565 10.1861 8.63741 10.5779 8.79883 10.9238C8.96389 11.2775 9.13316 11.5472 9.29297 11.707C9.68349 12.0975 10.3165 12.0975 10.707 11.707C11.0975 11.3165 11.0975 10.6835 10.707 10.293C10.5472 10.1332 10.2775 9.96389 9.92383 9.79883C9.57792 9.63741 9.18607 9.49565 8.81152 9.37793C8.59583 9.31014 8.38783 9.25179 8.20215 9.20215C8.25179 9.38783 8.31014 9.59583 8.37793 9.81152Z" fill="currentColor"></path></svg>',
  share: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 33 32" fill="none"><path d="M19.9047 4.26392C20.2002 3.93606 20.7077 3.90944 21.036 4.20455L29.036 11.4047L29.1485 11.5297C29.2466 11.6649 29.2999 11.8301 29.3 12C29.3 12.2266 29.2043 12.4436 29.036 12.5953L21.036 19.7954L20.9047 19.8907C20.5839 20.0792 20.1634 20.0233 19.9047 19.736C19.6463 19.4486 19.635 19.0243 19.8563 18.7251L19.9641 18.6048L26.4141 12.8H18.9C13.1565 12.8 8.50039 17.4566 8.50002 23.2001V26.4002L8.4844 26.5611C8.40996 26.9259 8.08677 27.2002 7.70002 27.2002C7.31328 27.2002 6.99009 26.9259 6.91565 26.5611L6.90002 26.4002V23.2001C6.90039 16.5729 12.2728 11.2 18.9 11.2H26.4141L19.9641 5.39519C19.6361 5.09956 19.6093 4.5922 19.9047 4.26392Z" fill="currentColor"></path></svg>',
  author: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15.5117 1.99707C15.9213 2.0091 16.3438 2.13396 16.6768 2.46679C17.0278 2.81814 17.1209 3.26428 17.0801 3.68261C17.0404 4.08745 16.8765 4.49344 16.6787 4.85058C16.3934 5.36546 15.9941 5.85569 15.6348 6.20898C15.7682 6.41421 15.8912 6.66414 15.9551 6.9453C16.0804 7.4977 15.9714 8.13389 15.4043 8.70116C14.8566 9.24884 13.974 9.54823 13.1943 9.71679C12.7628 9.81003 12.3303 9.86698 11.9473 9.90233C12.0596 10.2558 12.0902 10.7051 11.8779 11.2012L11.8223 11.3203C11.5396 11.8854 11.0275 12.2035 10.4785 12.3965C9.93492 12.5875 9.29028 12.6792 8.65332 12.75C7.99579 12.8231 7.34376 12.8744 6.70117 12.9775C6.14371 13.067 5.63021 13.1903 5.18652 13.3818L5.00585 13.4658C4.53515 14.2245 4.13745 14.9658 3.80957 15.6465C4.43885 15.2764 5.1935 15 5.99999 15C6.27614 15 6.49999 15.2238 6.49999 15.5C6.49999 15.7761 6.27613 16 5.99999 16C5.35538 16 4.71132 16.2477 4.15039 16.6103C3.58861 16.9736 3.14957 17.427 2.91601 17.7773C2.91191 17.7835 2.90568 17.788 2.90136 17.7939C2.88821 17.8119 2.8746 17.8289 2.85937 17.8447C2.85117 17.8533 2.84268 17.8612 2.83398 17.8691C2.81803 17.8835 2.80174 17.897 2.78417 17.9092C2.774 17.9162 2.76353 17.9225 2.75292 17.9287C2.73854 17.9372 2.72412 17.9451 2.70898 17.9521C2.69079 17.9605 2.6723 17.9675 2.65332 17.9736C2.6417 17.9774 2.63005 17.9805 2.61816 17.9834C2.60263 17.9872 2.5871 17.9899 2.57128 17.9922C2.55312 17.9948 2.53511 17.9974 2.5166 17.998C2.50387 17.9985 2.49127 17.9976 2.47851 17.9971C2.45899 17.9962 2.43952 17.9954 2.41992 17.9922C2.40511 17.9898 2.39062 17.9862 2.37597 17.9824C2.36477 17.9795 2.35294 17.9783 2.34179 17.9746C2.33697 17.973 2.33286 17.9695 2.32812 17.9678C2.31042 17.9612 2.29351 17.953 2.27636 17.9443C2.26332 17.9378 2.25053 17.9314 2.23828 17.9238C2.23339 17.9208 2.22747 17.9192 2.22265 17.916C2.21414 17.9103 2.20726 17.9026 2.19921 17.8965C2.18396 17.8849 2.16896 17.8735 2.15527 17.8603C2.14518 17.8507 2.13609 17.8404 2.12695 17.8301C2.11463 17.8161 2.10244 17.8023 2.09179 17.7871C2.08368 17.7756 2.07736 17.7631 2.07031 17.751C2.06168 17.7362 2.05297 17.7216 2.04589 17.706C2.03868 17.6901 2.03283 17.6738 2.02734 17.6572C2.0228 17.6436 2.01801 17.6302 2.01464 17.6162C2.01117 17.6017 2.009 17.587 2.00683 17.5722C2.00411 17.5538 2.00161 17.5354 2.00097 17.5166C2.00054 17.5039 2.00141 17.4912 2.00195 17.4785C2.00279 17.459 2.00364 17.4395 2.00683 17.4199C2.00902 17.4064 2.01327 17.3933 2.0166 17.3799C2.01973 17.3673 2.02123 17.3543 2.02539 17.3418C2.41772 16.1648 3.18163 14.466 4.30468 12.7012C4.31908 12.5557 4.34007 12.3582 4.36914 12.1201C4.43379 11.5907 4.53836 10.8564 4.69921 10.0381C5.0174 8.41955 5.56814 6.39783 6.50585 4.9912L6.73242 4.66894C7.27701 3.93277 7.93079 3.30953 8.61035 2.85156C9.3797 2.33311 10.2221 2 11.001 2C11.7951 2.00025 12.3531 2.35795 12.7012 2.70605C12.7723 2.77723 12.8348 2.84998 12.8896 2.91796C13.2829 2.66884 13.7917 2.39502 14.3174 2.21191C14.6946 2.08056 15.1094 1.98537 15.5117 1.99707ZM17.04 15.5537C17.1486 15.3 17.4425 15.1818 17.6963 15.29C17.95 15.3986 18.0683 15.6925 17.96 15.9463C17.4827 17.0612 16.692 18 15.5 18C14.6309 17.9999 13.9764 17.5003 13.5 16.7978C13.0236 17.5003 12.3691 18 11.5 18C10.6309 17.9999 9.97639 17.5003 9.49999 16.7978C9.02359 17.5003 8.36911 18 7.49999 18C7.22391 17.9999 7 17.7761 6.99999 17.5C6.99999 17.2239 7.22391 17 7.49999 17C8.07039 17 8.6095 16.5593 9.04003 15.5537L9.07421 15.4873C9.16428 15.3412 9.32494 15.25 9.49999 15.25C9.70008 15.25 9.88121 15.3698 9.95996 15.5537L10.042 15.7353C10.4581 16.6125 10.9652 16.9999 11.5 17C12.0704 17 12.6095 16.5593 13.04 15.5537L13.0742 15.4873C13.1643 15.3412 13.3249 15.25 13.5 15.25C13.7001 15.25 13.8812 15.3698 13.96 15.5537L14.042 15.7353C14.4581 16.6125 14.9652 16.9999 15.5 17C16.0704 17 16.6095 16.5593 17.04 15.5537ZM15.4824 2.99707C15.247 2.99022 14.9608 3.04682 14.6465 3.15624C14.0173 3.37541 13.389 3.76516 13.0498 4.01953C12.9277 4.11112 12.7697 4.14131 12.6221 4.10253C12.4745 4.06357 12.3522 3.9591 12.291 3.81933V3.81835C12.2892 3.81468 12.2861 3.80833 12.2822 3.80078C12.272 3.78092 12.2541 3.7485 12.2295 3.70898C12.1794 3.62874 12.1011 3.52019 11.9941 3.41308C11.7831 3.2021 11.4662 3.00024 11.001 2.99999C10.4904 2.99999 9.84173 3.22729 9.16894 3.68066C8.58685 4.07297 8.01568 4.61599 7.5371 5.26269L7.33789 5.54589C6.51634 6.77827 5.99475 8.63369 5.68066 10.2314C5.63363 10.4707 5.5913 10.7025 5.55371 10.9238C7.03031 9.01824 8.94157 7.19047 11.2812 6.05077C11.5295 5.92989 11.8283 6.03301 11.9492 6.28124C12.0701 6.52949 11.967 6.82829 11.7187 6.94921C9.33153 8.11208 7.38648 10.0746 5.91406 12.1103C6.12313 12.0632 6.33385 12.0238 6.54296 11.9902C7.21709 11.8821 7.92723 11.8243 8.54296 11.7558C9.17886 11.6852 9.72123 11.6025 10.1465 11.4531C10.5662 11.3056 10.8063 11.1158 10.9277 10.873L10.9795 10.7549C11.0776 10.487 11.0316 10.2723 10.9609 10.1123C10.918 10.0155 10.8636 9.93595 10.8203 9.88183C10.7996 9.85598 10.7822 9.83638 10.7715 9.82518L10.7607 9.81542L10.7627 9.8164L10.7646 9.81835C10.6114 9.67972 10.5597 9.46044 10.6338 9.26757C10.7082 9.07475 10.8939 8.94726 11.1006 8.94726C11.5282 8.94719 12.26 8.8956 12.9834 8.73925C13.7297 8.5779 14.3654 8.32602 14.6973 7.99413C15.0087 7.68254 15.0327 7.40213 14.9795 7.16698C14.9332 6.96327 14.8204 6.77099 14.707 6.62792L14.5957 6.50195C14.4933 6.39957 14.4401 6.25769 14.4502 6.11327C14.4605 5.96888 14.5327 5.83599 14.6484 5.74902C14.9558 5.51849 15.4742 4.96086 15.8037 4.3662C15.9675 4.07048 16.0637 3.80137 16.085 3.58593C16.1047 3.38427 16.0578 3.26213 15.9697 3.17382C15.8631 3.06726 15.7102 3.00377 15.4824 2.99707Z" fill="currentColor"></path></svg>'
}

function detailValueHtml(text, href) {
  const safe = htmlEscape(text);
  if (href) {
    return `<a class="hero-detail-value is-link u-text-style-body-3 u-rich-text" href="${htmlEscape(href)}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  }
  return `<div class="hero-detail-value u-text-style-body-3">${safe}</div>`;
}

// Official Category/Product can list several underlined links stacked.
function detailLinksHtml(values, href) {
  const list = (values || []).map(v => String(v || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return detailValueHtml(list[0], href);
  return `<div class="hero-detail-value-stack">${list.map((v, i) => {
    const link = i === 0 ? href : '';
    return detailValueHtml(v, link);
  }).join('')}</div>`;
}

function renderDetailItem(icon, label, valueHtml) {
  if (!valueHtml) return '';
  return `              <li class="hero-detail-item">
                <div class="hero-detail-icon">${icon}</div>
                <div class="hero-detail-content">
                  <div class="hero-detail-label u-text-style-caption u-foreground-tertiary">${htmlEscape(label)}</div>
                  ${valueHtml}
                </div>
              </li>`;
}

function renderArticleTopbar({ title, officialUrl, langToggleLabel, langToggleHref, markdownText, copyAskLabel, copyMdLabel, exploreLabel }) {
  return `<header class="article-topbar">
  <div class="container article-topbar-inner">
    <nav class="article-breadcrumb" aria-label="Breadcrumb">
      <ol class="breadcrumb-list">
        <li class="breadcrumb-item"><a class="breadcrumb-link" href="${BASE_PATH}/">Blog</a></li>
        <li class="breadcrumb-sep" aria-hidden="true">/</li>
        <li class="breadcrumb-item breadcrumb-current"><span>${htmlEscape(title)}</span></li>
      </ol>
    </nav>
    <div class="explore-dropdown" data-explore>
      <button type="button" class="explore-toggle" data-explore-toggle aria-expanded="false" aria-haspopup="true">
        <span>${htmlEscape(exploreLabel)}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.5 7.5L10 12L14.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="explore-menu" data-explore-menu hidden>
        <a class="explore-item" href="${htmlEscape(officialUrl)}" target="_blank" rel="noopener noreferrer">${htmlEscape(copyAskLabel)}</a>
        <button type="button" class="explore-item" data-copy-markdown>${htmlEscape(copyMdLabel)}</button>
        <a class="explore-item" href="${langToggleHref}">${htmlEscape(langToggleLabel)}</a>
      </div>
      <textarea class="u-sr-only" data-markdown-source readonly aria-hidden="true">${htmlEscape(markdownText)}</textarea>
    </div>
  </div>
</header>`;
}

function renderArticleHero(article, { title, subtitle, pageUrl }) {
  const illo = article.illustration
    ? `<div class="hero-illo-wrap" style="background-color: var(${illoVar(article.illustrationBg)});">
            <img class="hero-illo-img" src="${illoSrc(article)}" alt="" loading="lazy">
          </div>`
    : '';

  const productValues = facetValues(article, 'product');
  const categoryValues = facetValues(article, 'category');
  if (!categoryValues.length && article.category) categoryValues.push(article.category);
  const authors = Array.isArray(article.authors) ? article.authors.filter(Boolean) : [];
  const reading = article.readingMinutes > 0
    ? `<div class="hero-detail-value u-text-style-body-3"><span>${article.readingMinutes}</span> min</div>`
    : '';

  const details = [
    renderDetailItem(DETAIL_ICONS.category, 'Category', detailLinksHtml(categoryValues, article.categoryUrl)),
    renderDetailItem(DETAIL_ICONS.product, 'Product', detailLinksHtml(productValues, article.productUrl)),
    renderDetailItem(DETAIL_ICONS.date, 'Date', article.date ? detailValueHtml(article.date) : ''),
    renderDetailItem(DETAIL_ICONS.reading, 'Reading time', reading),
    renderDetailItem(
      DETAIL_ICONS.share,
      'Share',
      `<button type="button" class="hero-detail-value is-link hero-copy-link u-text-style-body-3 u-rich-text" data-copy-link data-copy-url="${htmlEscape(pageUrl)}">Copy link</button>`
    ),
    renderDetailItem(
      DETAIL_ICONS.author,
      'Author(s)',
      authors.length ? `<div class="hero-detail-value u-text-style-body-3">${htmlEscape(authors.join(', '))}</div>` : ''
    ),
  ].filter(Boolean).join('\n');

  return `<section class="hero-blog-post">
      <div class="container hero-blog-post-contain">
        <div class="hero-blog-post-layout">
          <div class="hero-blog-post-content">
            ${illo}
            <h1 class="article-title u-text-style-h1">${htmlEscape(title)}</h1>
            ${subtitle ? `<div class="hero-subtitle u-text-wrap-pretty"><p>${htmlEscape(subtitle)}</p></div>` : ''}
          </div>
          <aside class="hero-blog-post-details" aria-label="Article details">
            <ul class="hero-detail-list">
${details}
            </ul>
          </aside>
        </div>
      </div>
    </section>`;
}

const ARTICLE_JS = `  <script>
    (function () {
      function copyText(text, btn, okLabel) {
        var original = btn.textContent;
        function done(ok) {
          btn.textContent = ok ? (okLabel || 'Copied!') : original;
          setTimeout(function () { btn.textContent = original; }, 1600);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(false); });
        } else {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(true); } catch (e) { done(false); }
          document.body.removeChild(ta);
        }
      }
      document.querySelectorAll('[data-explore]').forEach(function (root) {
        var toggle = root.querySelector('[data-explore-toggle]');
        var menu = root.querySelector('[data-explore-menu]');
        if (!toggle || !menu) return;
        toggle.addEventListener('click', function () {
          var open = menu.hasAttribute('hidden');
          if (open) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.addEventListener('click', function (e) {
          if (!root.contains(e.target)) {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
          }
        });
        var mdBtn = root.querySelector('[data-copy-markdown]');
        var src = root.querySelector('[data-markdown-source]');
        if (mdBtn && src) {
          mdBtn.addEventListener('click', function () {
            copyText(src.value, mdBtn, 'Copied!');
          });
        }
      });
      document.querySelectorAll('[data-copy-link]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var url = btn.getAttribute('data-copy-url') || window.location.href;
          copyText(url, btn, 'Copied!');
        });
      });
    })();
  </script>`;

function buildArticlePage(article, hasTranslation, meta) {
  const contentHtml = hasTranslation
    ? readContent(path.join(ZH_DIR, article.slug, 'content.html'))
    : readContent(path.join(EN_DIR, article.slug, 'content.html'));
  const title = hasTranslation && article.translatedTitle ? article.translatedTitle : article.title;
  const subtitle = (hasTranslation && article.translatedSubtitle)
    ? article.translatedSubtitle
    : (article.subtitle || '');
  const pageUrl = `${SITE_URL}/posts/${article.slug}/`;
  const officialUrl = article.url || `https://claude.com/blog/${article.slug}`;
  const markdownText = `# ${title}\n\n${subtitle ? subtitle + '\n\n' : ''}${htmlToMarkdown(contentHtml)}`;

  const headerHtml = renderArticleTopbar({
    title,
    officialUrl,
    langToggleLabel: hasTranslation ? '阅读英文原文 →' : '阅读中文翻译 →',
    langToggleHref: hasTranslation
      ? `${BASE_PATH}/posts/${article.slug}/en.html`
      : `${BASE_PATH}/posts/${article.slug}/`,
    markdownText,
    copyAskLabel: '关于本页提问',
    copyMdLabel: '复制为 Markdown',
    exploreLabel: 'Explore here',
  });

  const body = `<main class="main article-main">
    ${renderArticleHero(article, { title, subtitle, pageUrl })}
    <div class="article-body-wrap">
      <div class="container article-body-layout">
        <div class="article-container">
          <article class="article">
            <div class="article-content u-rich-text">
              ${contentHtml}
            </div>
            <footer class="article-footer">
              <hr>
              <p><a href="${htmlEscape(officialUrl)}" target="_blank">查看原文</a> · 翻译由 AI 生成，如有不准确之处请以原文为准</p>
              <p><a href="${BASE_PATH}/">← 返回首页</a></p>
            </footer>
          </article>
        </div>
      </div>
    </div>
  </main>`;

  return renderPage({
    lang: 'zh-CN',
    title: `${title} — Claude Blog 中文翻译`,
    description: subtitle || title,
    body,
    headerHtml,
    footerVariant: 'zh',
    meta,
    bodyExtra: ARTICLE_JS,
  });
}

function buildEnglishPage(article, meta) {
  const contentHtml = readContent(path.join(EN_DIR, article.slug, 'content.html'));
  const title = article.title;
  const subtitle = article.subtitle || '';
  const pageUrl = `${SITE_URL}/posts/${article.slug}/en.html`;
  const officialUrl = article.url || `https://claude.com/blog/${article.slug}`;
  const markdownText = `# ${title}\n\n${subtitle ? subtitle + '\n\n' : ''}${htmlToMarkdown(contentHtml)}`;
  const hasZh = hasZhContent(article);

  const headerHtml = renderArticleTopbar({
    title,
    officialUrl,
    langToggleLabel: hasZh ? '阅读中文翻译 →' : '← Back to home',
    langToggleHref: hasZh ? `${BASE_PATH}/posts/${article.slug}/` : `${BASE_PATH}/`,
    markdownText,
    copyAskLabel: 'Ask questions about this page',
    copyMdLabel: 'Copy as markdown',
    exploreLabel: 'Explore here',
  });

  const body = `<main class="main article-main">
    ${renderArticleHero(article, { title, subtitle, pageUrl })}
    <div class="article-body-wrap">
      <div class="container article-body-layout">
        <div class="article-container">
          <article class="article">
            <div class="article-content u-rich-text">
              ${contentHtml}
            </div>
            <footer class="article-footer">
              <hr>
              <p><a href="${htmlEscape(officialUrl)}" target="_blank">View original</a></p>
              <p><a href="${BASE_PATH}/">← Back to home</a></p>
            </footer>
          </article>
        </div>
      </div>
    </div>
  </main>`;

  return renderPage({
    lang: 'en',
    title: `${article.title} — Claude Blog CN`,
    description: subtitle || article.title,
    body,
    headerHtml,
    footerVariant: 'en',
    meta,
    bodyExtra: ARTICLE_JS,
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
