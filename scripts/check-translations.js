#!/usr/bin/env node
/**
 * Lists articles that still need a Chinese pass.
 * A file existing is not enough: after extract-content.js grows the English
 * body, the old translation is marked translationStale, and structural
 * gaps (quotes / heading count / length) also count.
 *
 * Usage:
 *   node scripts/check-translations.js
 *   node scripts/check-translations.js --slug claude-for-commerce-agents
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const CONTENT_DIR = path.join(__dirname, '..', 'content', 'en');
const ZH_DIR = path.join(__dirname, '..', 'content', 'zh');
const META_FILE = path.join(__dirname, '..', 'content', 'index.json');

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

function countHeadings(html) {
  const $ = cheerio.load(html || '');
  return $('h2, h3').length;
}

function countQuotes(html) {
  const $ = cheerio.load(html || '');
  const seen = new Set();
  $('blockquote p, .article-testimonial blockquote p').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length >= 16) seen.add(t);
  });
  return seen.size;
}

if (!fs.existsSync(META_FILE)) {
  console.log(JSON.stringify({ needsTranslation: [], total: 0 }));
  process.exit(0);
}

const only = argValue('--slug');
const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
const needsTranslation = [];

for (const article of meta.articles || []) {
  if (only && article.slug !== only) continue;
  const reasons = [];
  const enFile = path.join(CONTENT_DIR, article.slug, 'content.html');
  const zhFile = path.join(ZH_DIR, article.slug, 'content.html');
  const enHtml = loadHtml(enFile);
  const zhHtml = loadHtml(zhFile);

  if (!enHtml) {
    reasons.push('missing English content.html (run npm run extract)');
  }
  if (!zhHtml) {
    reasons.push('missing Chinese content.html');
  } else if (enHtml) {
    if (article.translationStale) reasons.push('translationStale after English extract grew');
    const enChars = textOf(enHtml).length;
    const zhChars = textOf(zhHtml).length;
    const enH = countHeadings(enHtml);
    const zhH = countHeadings(zhHtml);
    const enQ = countQuotes(enHtml);
    const zhQ = countQuotes(zhHtml);
    if (enQ && zhQ < enQ) reasons.push(`quotes ${zhQ}/${enQ}`);
    if (enH >= 2 && zhH + 1 < enH) reasons.push(`headings ${zhH}/${enH}`);
    // Chinese packs tighter than English. Complete ZH is often 30–50% of
    // EN char count; only flag catastrophic stubs (old first-block leftovers).
    if (enChars > 400 && zhChars / enChars < 0.22) {
      reasons.push(`length ${zhChars}/${enChars} (${Math.round((zhChars / enChars) * 100)}%)`);
    }
  }

  if (reasons.length) {
    needsTranslation.push({
      slug: article.slug,
      title: article.title,
      date: article.date,
      category: article.category,
      url: article.url,
      enFile,
      enMeta: path.join(CONTENT_DIR, article.slug, 'meta.json'),
      reasons,
    });
  }
}

const payload = { needsTranslation, total: (meta.articles || []).length };
console.log(JSON.stringify(payload, null, 2));
if (needsTranslation.length) process.exitCode = 1;
