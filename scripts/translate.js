#!/usr/bin/env node
/**
 * translate.js
 * Saves translated content for an article.
 * Called by the agent turn to persist translation results.
 *
 * Usage: node scripts/translate.js <slug> <language> [--title "翻译标题"] [--content "翻译内容HTML"]
 * Or via stdin: echo '{"slug":"xxx","title":"...","content":"..."}' | node scripts/translate.js
 */

const fs = require('fs');
const path = require('path');

const ZH_DIR = path.join(__dirname, '..', 'content', 'zh');
const META_FILE = path.join(__dirname, '..', 'content', 'index.json');

function saveTranslation(slug, lang, title, content) {
  const dir = path.join(ZH_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });

  // Save translated content
  fs.writeFileSync(path.join(dir, 'content.html'), content, 'utf-8');

  // Update article meta
  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  const article = meta.articles.find(a => a.slug === slug);
  if (article) {
    article.translated = true;
    article.translatedTitle = title || article.title;
    article.translatedAt = new Date().toISOString();
    article.translateLang = lang || 'zh';
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  }

  // Save per-article meta
  const articleMeta = {
    slug,
    translatedTitle: title,
    translatedAt: new Date().toISOString(),
    lang,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(articleMeta, null, 2), 'utf-8');

  return { ok: true, slug };
}

// CLI mode
const args = process.argv.slice(2);
if (args.length >= 1 && args[0] !== '--stdin') {
  const slug = args[0];
  const lang = args[1] || 'zh';
  let title = null, content = null;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--title') title = args[++i];
    if (args[i] === '--content') content = args[++i];
  }
  const result = saveTranslation(slug, lang, title, content);
  console.log(JSON.stringify(result));
} else {
  // Read from stdin (for agent turn pipe)
  let input = '';
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const result = saveTranslation(data.slug, data.lang || 'zh', data.title, data.content);
      console.log(JSON.stringify(result));
    } catch (e) {
      console.error(JSON.stringify({ error: e.message }));
      process.exit(1);
    }
  });
}