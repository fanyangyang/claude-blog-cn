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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName, cls: el.className + '',
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
          color: cs.color, background: cs.backgroundColor,
          border: cs.border, borderRadius: cs.borderRadius,
          borderTop: cs.borderTop, borderBottom: cs.borderBottom, borderLeft: cs.borderLeft, borderRight: cs.borderRight,
          padding: cs.padding, margin: cs.margin,
          height: cs.height, minHeight: cs.minHeight, boxSizing: cs.boxSizing,
        };
      };
      const sels = ['.usecase_filters','.blog_filters_form','.nav_filters_inner','.form_main_field','select.form_main_field','.form_main_select','.form_main_select_wrap','.form_main_label'];
      const out = {};
      for (const s of sels) out[s] = pick(s);
      const sortEls = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /sort by/i.test(e.textContent));
      out['sortby_text'] = sortEls.map(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { tag: e.tagName, cls: e.className+'', text: e.textContent.trim(), rect:{w:Math.round(r.width),h:Math.round(r.height)}, fontSize:cs.fontSize, fontWeight:cs.fontWeight, color:cs.color }; });
      return out;
    });
    console.log('=== ' + name + ' ===');
    console.log(JSON.stringify(data, null, 2));
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
