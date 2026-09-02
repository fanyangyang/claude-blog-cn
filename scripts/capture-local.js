const { chromium } = require('playwright');
const EXE = '/Users/fanyangyang/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'networkidle', timeout: 30000 });
  await p.screenshot({ path: '/tmp/local-full.png', fullPage: true });
  for (const [sel, name] of [['.marquee_wrap','marquee'],['.usecase_filters','sidebar'],['.blog_filters_form','filters'],['.blog-grid','grid'],['.grid-card','card']]) {
    try { await p.locator(sel).first().screenshot({ path: `/tmp/local-${name}.png` }); console.log('ok '+name); }
    catch(e){ console.log('skip '+name); }
  }
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
