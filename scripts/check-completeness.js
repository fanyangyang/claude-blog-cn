#!/usr/bin/env node
/**
 * Compare each cached official page (article.html) with the stored English
 * body (content.html), and optionally the Chinese translation.
 *
 * Official posts split the body across extra CMS blocks (a second
 * [data-readtime="content"], testimonial sliders). A body that only kept the
 * first richtext will fail here.
 *
 * Usage:
 *   node scripts/check-completeness.js            # English body vs official cache
 *   node scripts/check-completeness.js --with-zh  # also flag short Chinese
 *   node scripts/check-completeness.js --slug <slug>
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { extractArticleContent } = require('./fetch-blog');

const REPO = path.join(__dirname, '..');
const EN_DIR = path.join(REPO, 'content', 'en');
const ZH_DIR = path.join(REPO, 'content', 'zh');
const META_FILE = path.join(REPO, 'content', 'index.json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : '';
}

function loadHtml(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

function textOf(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

function headings(html) {
  const $ = cheerio.load(html || '');
  const out = [];
  $('h2, h3').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  });
  return out;
}

function quotes(html) {
  const $ = cheerio.load(html || '');
  const out = [];
  const seen = new Set();
  $('blockquote p, .article-testimonial blockquote p, .card_testimonial_col_text').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length >= 16 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  });
  return out;
}

function missingNeedle(haystack, needle, n = 48) {
  const key = needle.slice(0, n);
  return key && !haystack.includes(key);
}

function checkArticle(slug) {
  const articleHtml = loadHtml(path.join(EN_DIR, slug, 'article.html'));
  const enHtml = loadHtml(path.join(EN_DIR, slug, 'content.html'));
  const zhHtml = loadHtml(path.join(ZH_DIR, slug, 'content.html'));
  const issues = [];

  if (!articleHtml) {
    issues.push('missing article.html cache');
    return { slug, issues, extractedChars: 0, enChars: 0, zhChars: 0 };
  }
  if (!enHtml) {
    issues.push('missing content/en content.html');
  }

  const extracted = extractArticleContent(articleHtml) || '';
  const extractedText = textOf(extracted);
  const enText = textOf(enHtml);
  const zhText = textOf(zhHtml);

  const extractedH = headings(extracted);
  const enH = headings(enHtml);
  const zhH = headings(zhHtml);
  const extractedQ = quotes(extracted);
  const enQ = quotes(enHtml);
  const zhQ = quotes(zhHtml);

  const missingHeadings = extractedH.filter((h) => missingNeedle(enText, h, 24));
  const missingQuotes = extractedQ.filter((q) => missingNeedle(enText, q, 56));
  if (missingHeadings.length) {
    issues.push(`EN missing headings: ${missingHeadings.join(' | ')}`);
  }
  if (missingQuotes.length) {
    issues.push(`EN missing ${missingQuotes.length} testimonial quote(s)`);
  }
  if (extractedText.length > 200 && enText.length / extractedText.length < 0.85) {
    const pct = Math.round((enText.length / extractedText.length) * 100);
    issues.push(`EN body is ${pct}% of official extract (${enText.length}/${extractedText.length} chars)`);
  }

  const withZh = process.argv.includes('--with-zh');
  if (withZh && zhHtml) {
    if (extractedQ.length && zhQ.length < extractedQ.length && enQ.length === extractedQ.length) {
      issues.push(`ZH has ${zhQ.length}/${extractedQ.length} testimonial quotes`);
    }
    if (extractedH.length >= 2 && zhH.length + 1 < extractedH.length && enH.length >= extractedH.length) {
      issues.push(`ZH has ${zhH.length}/${extractedH.length} h2/h3 headings`);
    }
  }

  return {
    slug,
    issues,
    extractedChars: extractedText.length,
    enChars: enText.length,
    zhChars: zhText.length,
    quotes: extractedQ.length,
    headings: extractedH.length,
  };
}

function main() {
  const only = argValue('--slug');
  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  const slugs = only
    ? [only]
    : (meta.articles || []).map((a) => a.slug).filter(Boolean);

  const results = slugs.map(checkArticle);
  const bad = results.filter((r) => r.issues.length);
  const payload = {
    checked: results.length,
    incomplete: bad.length,
    articles: bad,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (bad.length) process.exitCode = 1;
}

main();
