#!/usr/bin/env node
/**
 * check-translations.js
 * Lists articles that need translation. Returns JSON for the agent turn.
 */
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content', 'en');
const ZH_DIR = path.join(__dirname, '..', 'content', 'zh');
const META_FILE = path.join(__dirname, '..', 'content', 'index.json');

if (!fs.existsSync(META_FILE)) {
  console.log(JSON.stringify({ needsTranslation: [], total: 0 }));
  process.exit(0);
}

const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
const needsTranslation = [];

for (const article of meta.articles) {
  const zhDir = path.join(ZH_DIR, article.slug);
  const zhFile = path.join(zhDir, 'content.html');

  if (!fs.existsSync(zhFile)) {
    needsTranslation.push({
      slug: article.slug,
      title: article.title,
      date: article.date,
      category: article.category,
      url: article.url,
      enFile: path.join(CONTENT_DIR, article.slug, 'content.html'),
      enMeta: path.join(CONTENT_DIR, article.slug, 'meta.json'),
    });
  }
}

console.log(JSON.stringify({ needsTranslation, total: meta.articles.length }, null, 2));