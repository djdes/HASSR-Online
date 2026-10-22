import { countdownGifUrl } from "@/lib/mailing/countdown";
import { rubLabel } from "@/lib/mailing/kinds/promo-shared";

import { C, FONT, button, codeChip, e, footer, logo, renderDocument, type PromoMailView } from "./shared";

/**
 * «Обратный отсчёт»: срочность. Тёмная шапка с градиентом в индиго,
 * пульсирующая мятная точка «Акция идёт» (анимация — Apple Mail и iOS),
 * живой GIF-таймер (виден везде, где грузятся картинки), полоса оставшихся
 * дней, мини-сравнение цен, кнопка и чип промокода. Без срока (общий код
 * без даты окончания) вместо таймера — крупная плашка со скидкой.
 */

const DAY_MS = 86_400_000;

const CSS = `
.pulse{animation:pulse 1.8s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(124,245,192,.65);opacity:1}70%{box-shadow:0 0 0 9px rgba(124,245,192,0);opacity:.85}100%{box-shadow:0 0 0 0 rgba(124,245,192,0);opacity:1}}
.cd-head{background-image:linear-gradient(135deg,#0b1024 0%,#0b1024 42%,#3848c7 130%)}
@media only screen and (max-width:480px){
.cd-title{font-size:26px!important;line-height:32px!important}
.cd-big{font-size:64px!important;line-height:68px!important}
.cd-price{font-size:22px!important}
}
@media (prefers-color-scheme:dark){
.cd-track{background:#232c5c!important}
.cd-old{background:#1a2142!important;border-color:#2c3566!important}
}
`;

/** Сколько осталось целых суток (не меньше 1) и доля срока для полосы. */
export function countdownProgress(view: Pick<PromoMailView, "endsAt" | "now" | "durationDays">): { daysLeft: number; share: number } | null {
  if (!view.endsAt) return null;
  const left = Math.max(0, view.endsAt.getTime() - view.now.getTime());
  const daysLeft = Math.min(Math.max(1, Math.ceil(left / DAY_MS)), Math.max(1, view.durationDays));
  const share = Math.min(1, Math.max(0.02, left / (Math.max(1, view.durationDays) * DAY_MS)));
  return { daysLeft, share };
}

function progressBar(share: number, caption: string): string {
  const fill = Math.round(share * 100);
  const track =
    fill >= 100
      ? `<td height="10" bgcolor="${C.indigo}" style="height:10px;font-size:1px;line-height:10px;background:${C.indigo};border-radius:5px">&nbsp;</td>`
      : `<td width="${fill}%" height="10" bgcolor="${C.indigo}" style="height:10px;font-size:1px;line-height:10px;background:${C.indigo};border-radius:5px 0 0 5px">&nbsp;</td><td height="10" class="cd-track" bgcolor="${C.tintB}" style="height:10px;font-size:1px;line-height:10px;background:${C.tintB};border-radius:0 5px 5px 0">&nbsp;</td>`;
  return `<table role="presentation" class="cd-track" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.tintB}" style="background:${C.tintB};border-radius:5px"><tr>${track}</tr></table>
<p class="d-muted" style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:18px;font-weight:600;color:${C.muted}">${e(caption)}</p>`;
}

function priceCells(view: PromoMailView): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="50%" valign="top" style="padding:0 6px 0 0"><table role="presentation" class="cd-old" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.tintC}" style="background:${C.tintC};border:1px solid ${C.line};border-radius:16px;border-collapse:separate"><tr><td style="padding:16px 18px">
<div class="d-muted" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.muted}">Сейчас</div>
<div class="d-muted cd-price" style="margin-top:6px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${C.muted}">${e(rubLabel(view.prices.oldRub))}</div>
</td></tr></table></td>
<td width="50%" valign="top" style="padding:0 0 0 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.indigo}" style="background:${C.indigo};border-radius:16px;border-collapse:separate"><tr><td style="padding:16px 18px">
<div style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#dfe3ff">Со скидкой</div>
<div class="cd-price" style="margin-top:6px;font-family:${FONT};font-size:28px;line-height:30px;font-weight:800;color:#ffffff">${e(rubLabel(view.prices.newRub))}</div>
</td></tr></table></td>
</tr></table>`;
}

export function renderCountdown(view: PromoMailView): string {
  const progress = countdownProgress(view);
  const timer =
    view.endsAt && progress
      ? `<tr><td bgcolor="${C.dark}" style="background:${C.dark};line-height:0;font-size:0"><img class="m-img" src="${e(countdownGifUrl(view.origin, view.endsAt, "dark"))}" width="600" alt="${e(`До конца акции ${progress.daysLeft} дн.`)}" style="display:block;width:600px;max-width:100%;height:auto;border:0"></td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:24px 32px 0">${progressBar(progress.share, `Осталось ${progress.daysLeft} из ${view.durationDays} дн.`)}</td></tr>`
      : `<tr><td class="cd-head" bgcolor="${C.dark}" align="center" style="background-color:${C.dark};padding:4px 32px 36px"><div class="cd-big" style="font-family:${FONT};font-size:80px;line-height:84px;font-weight:800;letter-spacing:-0.04em;color:${C.mint}">&minus;${view.percent}&nbsp;%</div><div style="margin-top:6px;font-family:${FONT};font-size:15px;line-height:22px;color:#c7cbe0">на тариф «${e(view.tariff)}» ${e(view.until)}</div></td></tr>`;

  const body = `
<tr><td class="cd-head m-px" bgcolor="${C.dark}" style="background-color:${C.dark};background-image:linear-gradient(135deg,#0b1024 0%,#0b1024 42%,#3848c7 130%);border-radius:24px 24px 0 0;padding:24px 32px ${view.endsAt ? 22 : 18}px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle">${logo(view, "white-on-dark", 22)}</td>
<td valign="middle" align="right" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.mint};white-space:nowrap"><span class="pulse" style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${C.mint};vertical-align:middle"></span>&nbsp;&nbsp;Акция идёт</td>
</tr></table>
<h1 class="cd-title" style="margin:26px 0 0;font-family:${FONT};font-size:30px;line-height:36px;font-weight:800;color:#ffffff">${e(view.headline)}</h1>
</td></tr>
${timer}
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:24px 32px 6px">
<p class="d-body" style="margin:0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.body}">${e(view.lead)}</p>
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:16px 32px 6px">${priceCells(view)}</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" align="center" style="background:#ffffff;padding:22px 32px 34px">
${button({ href: view.ctaUrl, label: view.buttonText, bg: C.indigo, align: "center", shadow: "0 8px 22px rgba(85,102,246,.35)" })}
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" align="center" style="background:#ffffff;padding:18px 32px 8px">
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td>${codeChip(view, { bg: C.tintA, border: C.line2, color: C.body, codeColor: C.indigoDeep, cls: "d-tint" })}</td></tr></table>
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 24px 24px;padding:22px 32px 30px">
${footer(view, "light")}
</td></tr>`;
  return renderDocument({ view, bodyBg: C.page, light: true, css: CSS, body });
}
