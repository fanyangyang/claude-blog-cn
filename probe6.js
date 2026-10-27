const fs = require('fs');
const cheerio = require('cheerio');
const s = fs.readFileSync('content/zh/expanding-claude-for-nonprofits/content.html', 'utf-8');
const $ = cheerio.load(s, null, false);
console.log('article-testimonials count:', $('.article-testimonials').length);
const $block = $('.article-testimonials').first();
if ($block.length) {
  console.log('block html len:', $block.html().length);
  console.log('block outer start:', $block.toString().slice(0,80));
}
const html = $.html();
const start = html.indexOf('article-testimonials');
console.log('index:', start);
console.log('前后:', html.slice(start-220, start+60));
console.log('尾部 context:', html.slice(start, start+120));
// 找到区块结束位置：从 start 向前找 <div class="article-testimonials" 的开头
const divStart = html.lastIndexOf('<div class="article-testimonials"', start);
console.log('divStart:', divStart);
// 在 zh 中该 div 的闭合 </div> 位置——用简单平衡匹配
let depth = 0, end = -1, i = divStart;
for (; i < html.length; i++) {
  if (html.startsWith('<div', i)) { depth++; i += 3; }
  else if (html.startsWith('</div>', i)) { depth--; if (depth === 0) { end = i + 6; break; } i += 5; }
}
console.log('end:', end);
console.log('end context:', html.slice(end-80, end+120));
PYEOF
node probe6.js; rm -f probe6.js