#!/usr/bin/env node
// 提取英文正文的所有文本节点（含 mixed-content 文本），跳过 w-embed / script / style
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const EN = path.join(__dirname, '../content/en/what-a-task-costs-on-opus-5-5/content.html');
const $ = cheerio.load(fs.readFileSync(EN, 'utf-8'));

const nodes = [];
function walk(el) {
  $(el).contents().each((i, node) => {
    if (node.type === 'text') {
      const t = node.data.replace(/\s+/g, ' ').trim();
      if (t.length >= 1) {
        const parent = $(node).parent();
        const tag = parent[0] ? parent[0].tagName : '#text';
        // 检查祖先是否有 w-embed/script/style
        let skip = false;
        parent.parents().each((j, anc) => {
          const a = $(anc);
          if ((a.hasClass('w-embed') && a.hasClass('w-script')) || anc.tagName === 'script' || anc.tagName === 'style') skip = true;
        });
        if (!skip && !/^[\s\W_]+$/.test(t)) {
          nodes.push({ idx: nodes.length, tag, text: t });
        }
      }
    } else if (node.type === 'tag') {
      const tag = node.tagName;
      if (tag === 'script' || tag === 'style') return;
      if ($(node).hasClass('w-embed') && $(node).hasClass('w-script')) return;
      walk(node);
    }
  });
}
walk($('body'));

const out = path.join(__dirname, '../.translate-dump.json');
fs.writeFileSync(out, JSON.stringify(nodes, null, 1));
console.log(`total text nodes: ${nodes.length}`);
nodes.forEach(n => console.log(`${n.idx}\t[${n.tag}]\t${n.text.slice(0, 100)}`));
