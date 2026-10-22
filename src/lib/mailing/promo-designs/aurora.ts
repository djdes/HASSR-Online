import { rubLabel } from "@/lib/mailing/kinds/promo-shared";

import { C, FONT, button, checkDot, codeChip, e, footer, logo, renderDocument, spacer, type PromoMailView } from "./shared";

/**
 * «Северное сияние»: всё письмо тёмное, в герое — свечение индиго и
 * фиолетового (radial-gradient поверх цвета-запаса), огромное «−15 %»
 * мятным (градиентный текст — только где поддерживается), кнопка-градиент
 * с бегущим бликом. Анимация блика — Apple Mail и iOS; остальным статика.
 */

const CSS = `
@supports ((-webkit-background-clip:text) or (background-clip:text)){
.grad{background:linear-gradient(90deg,#7cf5c0,#a5b0ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
}
.shine{background-size:250% 100%,100% 100%;background-position:0 0,0 0;animation:shine 3.6s ease-in-out 1.2s infinite}
@keyframes shine{0%{background-position:-150% 0,0 0}55%,100%{background-position:150% 0,0 0}}
@media only screen and (max-width:480px){
.hero-num{font-size:72px!important;line-height:76px!important}
.hero-pad{padding:28px 20px 8px!important}
.hero{border-radius:20px!important}
.pill{font-size:12px!important}
}
`;

const SHINE_LAYER = "linear-gradient(110deg,transparent 40%,rgba(255,255,255,.35) 50%,transparent 60%),linear-gradient(90deg,#5566f6,#7a5cff)";

function benefitCards(view: PromoMailView): string {
  const items = view.benefits.slice(0, 3);
  if (items.length === 0) return "";
  const cells = items
    .map((text, i) => {
      const first = i === 0;
      const last = i === items.length - 1;
      return `<td class="m-stack m-gap" width="${Math.floor(100 / items.length)}%" valign="top" style="padding:0 ${last ? 0 : 6}px 0 ${first ? 0 : 6}px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#161c3a" style="background:#161c3a;border-radius:16px;padding:16px 16px 18px">
${checkDot({ bg: "#1c3a3a", color: C.mint, size: 24 })}
<p style="margin:12px 0 0;font-family:${FONT};font-size:14px;line-height:21px;font-weight:600;color:#e7e9f6">${e(text)}</p>
</td></tr></table></td>`;
    })
    .join("");
  return `<tr><td class="m-px" style="padding:24px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td></tr>`;
}

export function renderAurora(view: PromoMailView): string {
  const who = view.name && view.company ? `${view.name}, это для ${view.company}` : view.company ? `Это предложение для ${view.company}` : view.name ? `${view.name}, это для вас` : "";
  const whoLine = who
    ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.faint}">${e(who)}</p>`
    : "";
  const body = `
<tr><td class="hero" bgcolor="${C.dark}" style="background-color:${C.dark};background-image:radial-gradient(circle at 15% 0%,rgba(85,102,246,.55),transparent 55%),radial-gradient(circle at 90% 100%,rgba(122,92,255,.45),transparent 50%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09);border-radius:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="m-px" style="padding:28px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle">${logo(view, "white-on-dark")}</td>
<td valign="middle" align="right"><span class="pill" style="display:inline-block;padding:6px 14px;border:1px solid #3a4170;border:1px solid rgba(255,255,255,.25);border-radius:999px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:600;color:#c7cbe0">${e(view.until)}</span></td>
</tr></table>
</td></tr>
<tr><td class="hero-pad" style="padding:36px 32px 8px">
${whoLine}
<div class="hero-num grad" style="margin:0 0 14px;font-family:${FONT};font-size:96px;line-height:100px;font-weight:800;letter-spacing:-0.04em;color:${C.mint}">&minus;${view.percent}&nbsp;%</div>
<h1 style="margin:0;font-family:${FONT};font-size:28px;line-height:34px;font-weight:800;color:#ffffff">${e(view.headline)}</h1>
<p style="margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:25px;color:#c7cbe0">${e(view.lead)}</p>
<p style="margin:22px 0 24px;font-family:${FONT};color:#ffffff"><span style="font-size:18px;line-height:30px;color:#6f7592;text-decoration:line-through">${e(rubLabel(view.prices.oldRub))}</span>&nbsp;&nbsp;<span style="font-size:32px;line-height:36px;font-weight:800;color:#ffffff">${e(rubLabel(view.prices.newRub))}</span><span style="font-size:15px;line-height:20px;color:${C.faint}">&nbsp;/мес</span></p>
${button({ href: view.ctaUrl, label: view.buttonText, bg: C.indigo, bgImage: SHINE_LAYER, className: "shine", shadow: "0 10px 30px rgba(85,102,246,.45)" })}
</td></tr>
<tr><td class="m-px" style="padding:22px 32px 30px">
${codeChip(view, { bg: "#131a38", border: "#2c3566", color: "#c7cbe0", codeColor: C.mint })}
</td></tr>
</table>
</td></tr>
${benefitCards(view)}
${spacer(20)}
<tr><td class="m-px" bgcolor="${C.dark}" style="background:${C.dark};padding:20px 32px 32px;border-top:1px solid #1e2547">
${footer(view, "dark")}
</td></tr>`;
  return renderDocument({ view, bodyBg: C.dark, light: false, css: CSS, body });
}
