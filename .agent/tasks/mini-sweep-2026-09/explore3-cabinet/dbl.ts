import type { Page } from "playwright";
export async function clickText(p: Page, text: string, nth = 0) {
  const ok = await p.evaluate(`(()=>{const t=${JSON.stringify(text)};const els=[...document.querySelectorAll('button,a[href],[role=button],[role=menuitem]')].filter(e=>e.innerText.trim()===t&&e.getBoundingClientRect().width>0);if(!els[${nth}])return 'NOT FOUND: '+t;els[${nth}].click();return 'ok';})()`);
  if (ok !== "ok") throw new Error(String(ok));
}
/** Двойной тап: два клика подряд с зазором ms. */
export async function doubleClickText(p: Page, text: string, gap = 80) {
  const r = await p.evaluate(`(()=>{const t=${JSON.stringify(text)};const els=[...document.querySelectorAll('button,a[href],[role=button]')].filter(e=>e.innerText.trim()===t&&e.getBoundingClientRect().width>0);if(!els.length)return 'NOT FOUND: '+t;const b=els[els.length-1];b.click();return new Promise(res=>setTimeout(()=>{b.click();res('ok '+b.disabled)},${gap}));})()`);
  return r;
}
export async function listButtons(p: Page) {
  return await p.evaluate(`[...document.querySelectorAll('button,a[href],[role=button]')].filter(b=>b.getBoundingClientRect().width>0).map(b=>b.innerText.trim()).filter(Boolean)`);
}
