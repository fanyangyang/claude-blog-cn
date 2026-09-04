#!/usr/bin/env node
/**
 * Re-extract English bodies from cached official pages (article.html).
 * Does not hit the network. Marks a translation stale when the English
 * body grew by more than 80 characters.
 *
 * Usage:
 *   node scripts/extract-content.js
 *   node scripts/extract-content.js --slug claude-for-commerce-agents
 */
const fs = require('fs');
const path = require('path');
const { writeExtractedContent } = require('./fetch-blog');

const REPO = path.join(__dirname, '..');
const EN_DIR = path.join(REPO, 'content', 'en');
const ZH_DIR = path.join(REPO, 'content', 'zh');
const META_FILE = path.join(REPO, 'content', 'index.json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : '';
}

function loadIndex() {
  return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
}

function main() {
  const only = argValue('--slug');
  const index = loadIndex();
  const articles = (index.articles || []).filter((a) => a.slug && (!only || a.slug === only));

  let refreshed = 0;
  let unchanged = 0;
  let missing = 0;
  const stale = [];
  const changed = [];

  for (const article of articles) {
    const articleDir = path.join(EN_DIR, article.slug);
    const htmlFile = path.join(articleDir, 'article.html');
    if (!fs.existsSync(htmlFile)) {
      missing++;
      console.warn(`  ⚠ ${article.slug}: no article.html cache`);
      continue;
    }
    const result = writeExtractedContent(articleDir, fs.readFileSync(htmlFile, 'utf-8'));
    if (!result.written) {
      unchanged++;
      continue;
    }
    refreshed++;
    changed.push({
      slug: article.slug,
      prevChars: result.prevChars,
      nextChars: result.nextChars,
    });
    const zhFile = path.join(ZH_DIR, article.slug, 'content.html');
    if (fs.existsSync(zhFile) && result.nextChars > result.prevChars + 80) {
      article.translationStale = true;
      stale.push(article.slug);
    }
  }

  fs.writeFileSync(META_FILE, JSON.stringify(index, null, 2) + '\n', 'utf-8');

  const payload = {
    checked: articles.length,
    refreshed,
    unchanged,
    missing,
    stale: stale.length,
    changed,
    staleSlugs: stale,
  };
  console.log(JSON.stringify(payload, null, 2));
}

main();
