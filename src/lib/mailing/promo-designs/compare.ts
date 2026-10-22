import { rubLabel, rubNumber } from "@/lib/mailing/kinds/promo-shared";

import { C, FONT, button, checkDot, e, footer, logo, renderDocument, type PromoMailView } from "./shared";

/**
 * «Было / стало»: рациональная светлая. Две карточки цены («Сейчас» серым,
 * «С промокодом» в рамке индиго), мятная пилюля «Экономия N ₽ в месяц»,
 * список «что входит» с галочками, кнопка. Стрелка между карточками слегка
 * «движется» (анимация — Apple Mail и iOS); на телефоне карточки идут
 * столбиком, стрелка смотрит вниз.
 */

const CSS = `
.arr{animation:nudge 2.4s ease-in-out infinite}
.arr-v{animation:nudge-v 2.4s ease-in-out infinite}
@keyframes nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(6px)}}
@keyframes nudge-v{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}
@media only screen and (max-width:480px){
.cm-title{font-size:26px!important;line-height:32px!important}
.cm-arrow{display:none!important}
.cm-arrow-v{display:block!important;max-height:none!important;overflow:visible!important}
.cm-card{padding:20px 20px 22px!important}
}
@media (prefers-color-scheme:dark){
.cm-old{background:#1a2142!important;border-color:#2c3566!important}
.cm-new{background:#141a36!important;border-color:#7d8bff!important}
.cm-save{background:#12372e!important;color:#8ff0c4!important}
.cm-dot{background:#1d2650!important;color:#c9d1ff!important}
}
`;

function oldCard(view: PromoMailView): string {
  return `<table role="presentation" class="cm-old" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.tintC}" style="background:${C.tintC};border:1px solid ${C.line};border-radius:18px;border-collapse:separate"><tr><td class="cm-card" style="padding:22px 22px 24px">
<div class="d-muted" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted}">Сейчас</div>
<div class="d-muted" style="margin-top:12px;font-family:${FONT};font-size:30px;line-height:36px;font-weight:700;color:${C.muted}">${e(rubLabel(view.prices.oldRub))}<span style="font-size:14px;font-weight:600">&nbsp;/мес</span></div>
<div class="d-muted" style="margin-top:8px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.faint}">без скидки</div>
</td></tr></table>`;
}

function newCard(view: PromoMailView): string {
  return `<table role="presentation" class="cm-new" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;border:2px solid ${C.indigo};border-radius:18px;border-collapse:separate"><tr><td class="cm-card" style="padding:21px 22px 23px">
<div style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.indigo}">С промокодом</div>
<div class="d-ink" style="margin-top:12px;font-family:${FONT};font-size:40px;line-height:44px;font-weight:800;letter-spacing:-0.02em;color:${C.ink}">${e(rubLabel(view.prices.newRub))}<span class="d-muted" style="font-size:14px;font-weight:600;letter-spacing:0;color:${C.muted}">&nbsp;/мес</span></div>
<div class="cm-save" style="display:inline-block;margin-top:12px;padding:5px 12px;border-radius:999px;background:#ecfdf5;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:#116b2a">Экономия&nbsp;${e(rubNumber(view.prices.savingRub))}&nbsp;₽ в месяц</div>
</td></tr></table>`;
}

function includes(view: PromoMailView): string {
  if (view.benefits.length === 0) return "";
  const rows = view.benefits
    .map(
      (text) => `<tr>
<td width="34" valign="top" style="padding:0 0 12px">${checkDot({ bg: C.tintB, color: C.indigoDeep, size: 22, cls: "cm-dot" })}</td>
<td valign="top" class="d-ink" style="padding:1px 0 12px;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink}">${e(text)}</td>
</tr>`
    )
    .join("");
  return `<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:30px 32px 6px">
<h2 class="d-ink" style="margin:0 0 16px;font-family:${FONT};font-size:18px;line-height:24px;font-weight:800;color:${C.ink}">Что входит в тариф «${e(view.tariff)}»</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr>`;
}

export function renderCompare(view: PromoMailView): string {
  const small = `Промокод <span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-weight:700;color:${C.indigoDeep}" class="d-link">${e(view.code)}</span> применится сам по ссылке. Он действует ${e(view.until)}.${view.lifetime ? " Скидка остаётся и на следующие оплаты." : ""}`;
  const body = `
<tr><td class="d-card m-px d-line" bgcolor="#ffffff" style="background:#ffffff;padding:22px 32px;border-bottom:1px solid ${C.line}">${logo(view, "dark-on-light", 24)}</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:36px 32px 8px">
<h1 class="d-ink cm-title" style="margin:0;font-family:${FONT};font-size:30px;line-height:36px;font-weight:800;color:${C.ink}">${e(view.headline)}</h1>
<p class="d-body" style="margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.body}">${e(view.lead)}</p>
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:24px 32px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="m-stack" width="50%" valign="middle">${oldCard(view)}</td>
<td class="m-stack" width="36" align="center" valign="middle" style="width:36px">
<div class="arr cm-arrow" style="font-family:Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:${C.indigo}">&rarr;</div>
<div class="arr-v cm-arrow-v m-only" style="display:none;mso-hide:all;max-height:0;overflow:hidden;text-align:center;font-family:Arial,sans-serif;font-size:22px;line-height:32px;font-weight:700;color:${C.indigo}">&darr;</div>
</td>
<td class="m-stack" width="50%" valign="middle">${newCard(view)}</td>
</tr></table>
</td></tr>
${includes(view)}
<tr><td class="d-card m-px" bgcolor="#ffffff" align="center" style="background:#ffffff;padding:22px 32px 34px">
${button({ href: view.ctaUrl, label: view.buttonText, bg: C.indigo, align: "center", shadow: "0 8px 22px rgba(85,102,246,.35)" })}
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" align="center" style="background:#ffffff;padding:16px 32px 6px"><p class="d-muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${small}</p></td></tr>
<tr><td class="d-card m-px d-line" bgcolor="#ffffff" style="background:#ffffff;padding:22px 32px 30px">
${footer(view, "light")}
</td></tr>`;
  return renderDocument({ view, bodyBg: "#ffffff", light: true, css: CSS, body });
}
