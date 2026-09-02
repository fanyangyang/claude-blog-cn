const { chromium } = require('playwright');
const EXE = '/Users/fanyangyang/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('https://claude.com/blog', { waitUntil: 'networkidle', timeout: 60000 });
  await p.screenshot({ path: '/tmp/official-full.png', fullPage: true });
  for (const [sel, name] of [
    ['.hero_blog_wrap', 'hero'], ['.marquee_wrap', 'marquee'],
    ['.usecase_filters', 'sidebar'], ['.blog_filters_form', 'filters'],
    ['.blog_cms_grid', 'grid'], ['.card_blog_wrap', 'card'],
  ]) {
    try { await p.locator(sel).first().screenshot({ path: `/tmp/official-${name}.png` }); console.log('ok ' + name); }
    catch (e) { console.log('skip ' + name + ': ' + e.message.slice(0,60)); }
  }
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
