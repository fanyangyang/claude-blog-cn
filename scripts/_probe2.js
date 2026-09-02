const { chromium } = require('playwright');
const EXE = '/Users/fanyangyang/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
(async () => {
  const targets = [
    ['local', 'http://127.0.0.1:8099/'],
    ['official', 'https://claude.com/blog'],
  ];
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  for (const [name, url] of targets) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
    } catch (e) { console.log('=== '+name+' nav warn: '+e.message); }
    const data = await page.evaluate(() => {
      // Find the Sort by container: look for element whose subtree contains "Sort by" text
      const all = [...document.querySelectorAll('*')];
      let sortRoot = null;
      for (const el of all) {
        if (el.children.length > 0 && /sort by/i.test(el.textContent) && el.textContent.length < 200) { sortRoot = el; break; }
      }
      if (!sortRoot) {
        const leaf = all.find(e => e.children.length === 0 && /sort by/i.test(e.textContent));
        sortRoot = leaf ? leaf.closest('div,span,label,form,aside') : null;
      }
      const describe = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName, cls: (el.className+'').slice(0,120),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
          color: cs.color, background: cs.backgroundColor,
          border: cs.border, borderRadius: cs.borderRadius,
          padding: cs.padding, margin: cs.margin,
          height: cs.height, minHeight: cs.minHeight, boxSizing: cs.boxSizing, display: cs.display, position: cs.position,
        };
      };
      const out = { sortRoot: describe(sortRoot) };
      if (sortRoot) {
        out.sortRootHTML = sortRoot.outerHTML.slice(0, 1500);
        out.children = [...sortRoot.querySelectorAll('*')].map(describe);
      }
      // Also specific sels
      const sels = ['.stories_filters_dropdown','.stories_filters_dropdown_text','.stories_filters_dropdown_btn','.form_main_field','.form_main_select_wrap','.usecase_filters'];
      out.sels = {}; for (const s of sels) out.sels[s] = describe(document.querySelector(s));
      return out;
    });
    console.log('=== ' + name + ' ===');
    console.log(JSON.stringify(data, null, 2));
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
