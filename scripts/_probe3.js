const { chromium } = require('playwright');
const EXE = '/Users/fanyangyang/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  for (const [name, url] of [['official','https://claude.com/blog'],['local','http://127.0.0.1:8099/']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch(e){}
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const html = document.documentElement;
      const hcs = getComputedStyle(html);
      const bcs = getComputedStyle(document.body);
      const find = (sel)=>document.querySelector(sel);
      const cs = (el)=> el ? getComputedStyle(el) : null;
      const toggle = find('.stories_filters_dropdown_toggle');
      const text = find('.stories_filters_dropdown_text');
      const wrap = find('.stories_filters_dropdown_wrap');
      const field = find('select.form_main_field');
      const selectWrap = find('.form_main_select_wrap');
      const iconDesktop = [...document.querySelectorAll('.stories_filters_dropdown_icon')].find(e=>e.classList.contains('is-desktop'));
      const iconMobile = [...document.querySelectorAll('.stories_filters_dropdown_icon')].find(e=>e.classList.contains('is-mobile'));
      const cap = find('.u-text-style-caption');
      const pick = (el)=>{ if(!el) return null; const c=getComputedStyle(el); const r=el.getBoundingClientRect(); return {fontSize:c.fontSize,lineHeight:c.lineHeight,padding:c.padding,margin:c.margin,height:c.height,color:c.color,display:c.display,rect:{w:Math.round(r.width),h:Math.round(r.height)}}; };
      return {
        htmlFontSize: hcs.fontSize,
        bodyFontSize: bcs.fontSize,
        captionDef: cap ? { fontSize: getComputedStyle(cap).fontSize, class: cap.className+'' } : null,
        toggle: pick(toggle), text: pick(text), wrap: pick(wrap),
        field: pick(field), selectWrap: pick(selectWrap),
        iconDesktop: pick(iconDesktop), iconMobile: pick(iconMobile),
        hasIsDesktop: !!iconDesktop,
      };
    });
    console.log('=== '+name+' ===');
    console.log(JSON.stringify(data,null,2));
    await page.close();
  }
  await browser.close();
})().catch(e=>{console.error('ERR '+e.message);process.exit(1);});
