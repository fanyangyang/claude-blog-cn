#!/usr/bin/env node
/**
 * build-site.js
 * Generates the GitHub Pages static site from fetched content.
 * Creates:
 *   - index.html (blog listing matching Claude's layout)
 *   - posts/[slug]/index.html (each article page)
 *   - assets/ (CSS, images)
 */

const fs = require('fs');
const path = require('path');

const META_FILE = path.join(__dirname, '..', 'content', 'index.json');
const ZH_DIR = path.join(__dirname, '..', 'content', 'zh');
const EN_DIR = path.join(__dirname, '..', 'content', 'en');
const SITE_DIR = path.join(__dirname, '..');

const categoryIcons = {
  'Product announcements': '🚀',
  'Agents': '🤖',
  'Claude Code': '💻',
  'Enterprise AI': '🏢',
  'Engineering': '⚙️',
  'Research': '🔬',
  'Safety': '🛡️',
  'General': '📝',
};

function htmlEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildIndex(meta) {
  const articles = meta.articles || [];

  const cards = articles.map((a, i) => {
    const hasZh = fs.existsSync(path.join(ZH_DIR, a.slug, 'content.html'));
    const title = hasZh && a.translatedTitle ? a.translatedTitle : a.title;
    const link = hasZh ? `/posts/${a.slug}/` : `/posts/${a.slug}/en.html`;
    const langLabel = hasZh ? '' : '<span class="lang-badge">EN</span>';
    const icon = categoryIcons[a.category] || '📝';

    return `
      <div class="blog-card">
        <div class="card-visual" style="background: var(--card-bg-${i % 5});">
          <div class="card-emoji">${icon}</div>
        </div>
        <div class="card-content">
          <div class="card-date">${a.date}</div>
          <h2 class="card-title">${htmlEscape(title)}${langLabel}</h2>
          <div class="card-tags">
            <span class="tag">${htmlEscape(a.category)}</span>
          </div>
          <a href="${link}" class="card-link">阅读全文 →</a>
        </div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Blog 中文翻译</title>
  <meta name="description" content="Claude by Anthropic 官方博客的中文翻译镜像站，定时同步更新。">
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="alternate" type="application/rss+xml" title="Claude Blog 中文翻译 RSS" href="/rss.xml">
</head>
<body>
  <header class="header">
    <div class="container">
      <div class="header-inner">
        <a href="/" class="logo">
          <span class="logo-icon">🦞</span>
          <span class="logo-text">Claude Blog <span class="logo-cn">中文</span></span>
        </a>
        <nav class="nav">
          <a href="/" class="nav-link active">首页</a>
          <a href="/rss.xml" class="nav-link">RSS</a>
          <a href="https://claude.com/blog" class="nav-link" target="_blank">原文 →</a>
        </nav>
      </div>
    </div>
  </header>

  <main class="main">
    <div class="container">
      <div class="hero">
        <h1>Claude Blog</h1>
        <p class="hero-subtitle">中文翻译 · 定时同步 · 免费开源</p>
        <p class="hero-desc">Anthropic 官方博客的中文翻译镜像站。内容自动同步，由 AI 翻译，保持与原文同步更新。</p>
      </div>

      <div class="blog-grid">
        ${cards}
      </div>
    </div>
  </main>

  <footer class="footer">
    <div class="container">
      <p>内容来自 <a href="https://claude.com/blog" target="_blank">Claude Blog</a> · 翻译由 AI 生成 · <a href="https://github.com/fanyangyang/claude-blog-cn" target="_blank">GitHub 仓库</a></p>
      <p class="footer-meta">最后更新：${meta.lastFetched ? new Date(meta.lastFetched).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-'}</p>
    </div>
  </footer>
</body>
</html>`;
}

function buildArticlePage(article, hasTranslation) {
  const enContentPath = path.join(EN_DIR, article.slug, 'content.html');

  let contentHtml = '';
  let title = article.title;

  if (hasTranslation) {
    const zhContentPath = path.join(ZH_DIR, article.slug, 'content.html');
    if (fs.existsSync(zhContentPath)) {
      contentHtml = fs.readFileSync(zhContentPath, 'utf-8');
    }
    if (article.translatedTitle) {
      title = article.translatedTitle;
    }
  } else {
    if (fs.existsSync(enContentPath)) {
      contentHtml = fs.readFileSync(enContentPath, 'utf-8');
    }
  }

  // Clean up content — remove empty paragraphs, normalize
  contentHtml = contentHtml
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/g, '<br>');

  const langLabel = hasTranslation ? '' : '<span class="lang-badge-large">EN</span>';
  const langToggle = hasTranslation
    ? `<a href="/posts/${article.slug}/en.html" class="lang-toggle">阅读英文原文 →</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlEscape(title)} — Claude Blog 中文翻译</title>
  <meta name="description" content="${htmlEscape(title)}">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header class="header">
    <div class="container">
      <div class="header-inner">
        <a href="/" class="logo">
          <span class="logo-icon">🦞</span>
          <span class="logo-text">Claude Blog <span class="logo-cn">中文</span></span>
        </a>
        <nav class="nav">
          <a href="/" class="nav-link">首页</a>
          <a href="https://claude.com/blog/${article.slug}" class="nav-link" target="_blank">原文 →</a>
        </nav>
      </div>
    </div>
  </header>

  <main class="main">
    <div class="container article-container">
      <article class="article">
        <header class="article-header">
          <div class="article-meta">
            <span class="tag">${article.category}</span>
            <span class="article-date">${article.date}</span>
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
          <p><a href="/">← 返回首页</a></p>
        </footer>
      </article>
    </div>
  </main>

  <footer class="footer">
    <div class="container">
      <p>内容来自 <a href="https://claude.com/blog" target="_blank">Claude Blog</a> · 翻译由 AI 生成</p>
    </div>
  </footer>
</body>
</html>`;
}

function buildEnglishPage(article) {
  const enContentPath = path.join(EN_DIR, article.slug, 'content.html');
  let contentHtml = '';
  if (fs.existsSync(enContentPath)) {
    contentHtml = fs.readFileSync(enContentPath, 'utf-8');
  }
  contentHtml = contentHtml.replace(/<p>\s*<\/p>/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlEscape(article.title)} — Claude Blog CN</title>
  <meta name="description" content="${htmlEscape(article.title)}">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header class="header">
    <div class="container">
      <div class="header-inner">
        <a href="/" class="logo">
          <span class="logo-icon">🦞</span>
          <span class="logo-text">Claude Blog <span class="logo-cn">中文</span></span>
        </a>
        <nav class="nav">
          <a href="/" class="nav-link">首页</a>
          <a href="/posts/${article.slug}/" class="nav-link">中文版 →</a>
        </nav>
      </div>
    </div>
  </header>

  <main class="main">
    <div class="container article-container">
      <article class="article">
        <header class="article-header">
          <div class="article-meta">
            <span class="tag">${article.category}</span>
            <span class="article-date">${article.date}</span>
            <span class="lang-badge-large">EN</span>
          </div>
          <h1 class="article-title">${htmlEscape(article.title)}</h1>
          <a href="/posts/${article.slug}/" class="lang-toggle">阅读中文翻译 →</a>
        </header>
        <div class="article-content u-rich-text">
          ${contentHtml}
        </div>
        <footer class="article-footer">
          <hr>
          <p><a href="https://claude.com/blog/${article.slug}" target="_blank">View original</a></p>
          <p><a href="/">← Back to home</a></p>
        </footer>
      </article>
    </div>
  </main>

  <footer class="footer">
    <div class="container">
      <p>Content from <a href="https://claude.com/blog" target="_blank">Claude Blog</a> · Translation by AI</p>
    </div>
  </footer>
</body>
</html>`;
}

function buildRSS(meta) {
  const articles = meta.articles || [];
  const items = articles.map(a => {
    const hasZh = fs.existsSync(path.join(ZH_DIR, a.slug, 'content.html'));
    const title = hasZh && a.translatedTitle ? a.translatedTitle : a.title;
    const link = hasZh
      ? `https://claude-blog-cn.vercel.app/posts/${a.slug}/`
      : `https://claude-blog-cn.vercel.app/posts/${a.slug}/en.html`;
    const date = a.date ? new Date(a.date).toUTCString() : new Date().toUTCString();
    return `    <item>
      <title>${htmlEscape(title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${date}</pubDate>
      <category>${a.category}</category>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Claude Blog 中文翻译</title>
    <link>https://claude-blog-cn.vercel.app</link>
    <description>Anthropic Claude 官方博客的中文翻译</description>
    <atom:link href="https://claude-blog-cn.vercel.app/rss.xml" rel="self" type="application/rss+xml"/>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

async function main() {
  if (!fs.existsSync(META_FILE)) {
    console.error('No content/index.json found. Run "npm run fetch" first.');
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  const articles = meta.articles || [];

  console.log(`Building site for ${articles.length} articles...`);

  // Build index
  const indexHtml = buildIndex(meta);
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), indexHtml, 'utf-8');
  console.log('  ✓ index.html');

  // Build RSS
  const rssXml = buildRSS(meta);
  fs.writeFileSync(path.join(SITE_DIR, 'rss.xml'), rssXml, 'utf-8');
  console.log('  ✓ rss.xml');

  // Build article pages
  let pageCount = 0;
  for (const article of articles) {
    const hasZh = fs.existsSync(path.join(ZH_DIR, article.slug, 'content.html'));
    const postDir = path.join(SITE_DIR, 'posts', article.slug);
    fs.mkdirSync(postDir, { recursive: true });

    if (hasZh) {
      // Chinese page
      const zhHtml = buildArticlePage(article, true);
      fs.writeFileSync(path.join(postDir, 'index.html'), zhHtml, 'utf-8');
      pageCount++;
    }

    // Always build English version for reference
    if (fs.existsSync(path.join(EN_DIR, article.slug, 'content.html'))) {
      const enHtml = buildEnglishPage(article);
      fs.writeFileSync(path.join(postDir, 'en.html'), enHtml, 'utf-8');
    }

    pageCount++;
  }

  console.log(`  ✓ ${pageCount} article pages`);
  console.log('Done!');
}

main().catch(console.error);