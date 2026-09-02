const { chromium } = require('playwright');
const EXE = '/Users/fanyangyang/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const [url, out, selector] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(5000);
  if (selector) await p.locator(selector).first().screenshot({ path: out });
  else await p.screenshot({ path: out, fullPage: true });
  await b.close();
  console.log('saved ' + out);
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
