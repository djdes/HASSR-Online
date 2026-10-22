import { C, FONT, MONO, button, e, footer, logo, renderDocument, type PromoMailView } from "./shared";

/**
 * «Купон»: светлая «тактильная» карточка с билетом. Слева индиго «−15 %»,
 * справа белое поле с кодом в пунктирной рамке, между ними перфорация с
 * полукруглыми вырезами (цвет вырезов — фон подложки билета). На телефоне
 * билет ложится столбиком, перфорация становится горизонтальной.
 * Лёгкое «покачивание» билета — анимация для Apple Mail и iOS.
 */

const BAND = C.page; // подложка билета: в неё «врезаны» полукруги

const CSS = `
.ticket{animation:sway 6s ease-in-out 1s infinite;transform-origin:50% 50%}
@keyframes sway{0%,90%,100%{transform:rotate(0)}93%{transform:rotate(-.6deg)}97%{transform:rotate(.6deg)}}
@media only screen and (max-width:480px){
.cp-left{display:block!important;width:100%!important;box-sizing:border-box;border-radius:16px 16px 0 0!important;padding:24px 20px!important}
.cp-right{display:block!important;width:100%!important;box-sizing:border-box;border-radius:0 0 16px 16px!important;padding:20px 16px 24px!important}
.cp-mid{display:block!important;width:100%!important;height:24px!important}
.cp-mid-v{display:none!important}
.cp-mid-h{display:table!important}
.cp-pad{padding:28px 20px 8px!important}
}
@media (prefers-color-scheme:dark){
.cp-band{background:#0f1530!important}
.cp-notch{background:#0f1530!important}
.cp-right,.cp-mid,.cp-mid-h{background:#1a2142!important}
.cp-codebox{background:#232c5c!important;border-color:#7d8bff!important;color:#ffffff!important}
.cp-num{background:#1d2650!important;color:#c9d1ff!important}
}
`;

/** Размер кода: подбираем так, чтобы он помещался в одну строку правой части билета (~205 px). */
function codeFontSize(code: string): number {
  return Math.max(13, Math.min(28, Math.floor(205 / (0.72 * Math.max(1, code.length)))));
}

/** Вертикальная перфорация (десктоп): вырез сверху, пунктир, вырез снизу. */
function perforationVertical(): string {
  return `<table role="presentation" class="cp-mid-v" width="24" height="100%" cellpadding="0" cellspacing="0" border="0" style="width:24px;height:100%">
<tr><td height="12" class="cp-notch" bgcolor="${BAND}" style="height:12px;font-size:1px;line-height:12px;background:${BAND};border-radius:0 0 12px 12px">&nbsp;</td></tr>
<tr><td align="center" style="font-size:1px;line-height:1px"><div style="width:0;height:120px;margin:0 auto;border-left:2px dashed ${C.line2}">&nbsp;</div></td></tr>
<tr><td height="12" class="cp-notch" bgcolor="${BAND}" style="height:12px;font-size:1px;line-height:12px;background:${BAND};border-radius:12px 12px 0 0">&nbsp;</td></tr>
</table>`;
}

/** Горизонтальная перфорация (телефон): вырезы по бокам, пунктир посередине. */
function perforationHorizontal(): string {
  return `<table role="presentation" class="m-only cp-mid-h" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;height:24px;display:none;mso-hide:all;background:#ffffff">
<tr>
<td width="12" height="24" class="cp-notch" bgcolor="${BAND}" style="width:12px;height:24px;font-size:1px;line-height:24px;background:${BAND};border-radius:0 12px 12px 0">&nbsp;</td>
<td valign="middle" style="font-size:1px;line-height:1px"><div style="height:0;margin:0 8px;border-top:2px dashed ${C.line2}">&nbsp;</div></td>
<td width="12" height="24" class="cp-notch" bgcolor="${BAND}" style="width:12px;height:24px;font-size:1px;line-height:24px;background:${BAND};border-radius:12px 0 0 12px">&nbsp;</td>
</tr></table>`;
}

function ticket(view: PromoMailView): string {
  const size = codeFontSize(view.code);
  return `<table role="presentation" class="ticket" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate">
<tr>
<td class="cp-left m-stack" width="200" height="160" align="center" valign="middle" bgcolor="${C.indigo}" style="width:200px;height:160px;background:${C.indigo};border-radius:16px 0 0 16px;padding:20px">
<div style="font-family:${FONT};font-size:56px;line-height:58px;font-weight:800;letter-spacing:-0.03em;color:#ffffff">&minus;${view.percent}&nbsp;%</div>
<div style="margin-top:6px;font-family:${FONT};font-size:15px;line-height:20px;color:#dfe3ff">на тариф «${e(view.tariff)}»</div>
</td>
<td class="cp-mid m-stack" width="24" valign="top" bgcolor="#ffffff" style="width:24px;background:#ffffff;padding:0">${perforationVertical()}${perforationHorizontal()}</td>
<td class="cp-right m-stack" align="center" valign="middle" bgcolor="#ffffff" style="background:#ffffff;border-radius:0 16px 16px 0;padding:20px 24px 20px 12px">
<div class="d-muted" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted}">Ваш промокод</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:10px auto 0;border-collapse:separate"><tr><td class="cp-codebox" bgcolor="${C.tintA}" align="center" style="background:${C.tintA};border:2px dashed ${C.indigo};border-radius:12px;padding:10px 14px;font-family:${MONO};font-size:${size}px;line-height:${size + 6}px;font-weight:700;letter-spacing:.12em;color:${C.ink};white-space:nowrap">${e(view.code)}</td></tr></table>
<div class="d-muted" style="margin-top:10px;font-family:${FONT};font-size:13px;line-height:18px;color:${C.muted}">действует ${e(view.until)}</div>
</td>
</tr></table>`;
}

function steps(view: PromoMailView): string {
  const items = [`Нажмите «${view.buttonText}»`, "Код применится сам", "Оплатите — скидка уже в счёте"];
  return items
    .map(
      (text, i) => `<tr>
<td width="44" valign="top" style="padding:0 0 12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="cp-num" align="center" valign="middle" width="30" height="30" bgcolor="${C.tintB}" style="width:30px;height:30px;border-radius:15px;background:${C.tintB};font-family:${FONT};font-size:14px;line-height:30px;font-weight:800;color:${C.indigoDeep}">${i + 1}</td></tr></table></td>
<td valign="middle" class="d-ink" style="padding:0 0 12px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:${C.ink}">${e(text)}</td>
</tr>`
    )
    .join("");
}

export function renderCoupon(view: PromoMailView): string {
  const body = `
<tr><td class="d-card" bgcolor="${C.dark}" style="background:${C.dark};border-radius:24px 24px 0 0;padding:18px 32px">${logo(view, "white-on-dark", 22)}</td></tr>
<tr><td class="d-card cp-pad m-px" bgcolor="#ffffff" style="background:#ffffff;padding:36px 32px 8px">
<h1 class="d-ink" style="margin:0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:800;color:${C.ink}">${e(view.headline)}</h1>
<p class="d-body" style="margin:10px 0 0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.body}">${e(view.lead)}</p>
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:20px 32px 8px">
<table role="presentation" class="cp-band" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BAND}" style="background:${BAND};border-radius:20px"><tr><td style="padding:20px 18px">${ticket(view)}</td></tr></table>
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" align="center" style="background:#ffffff;padding:24px 32px 34px">
${button({ href: view.ctaUrl, label: view.buttonText, bg: C.indigo, align: "center", shadow: "0 8px 22px rgba(85,102,246,.35)" })}
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:28px 32px 8px">
<div class="d-muted" style="margin:0 0 14px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted}">Как это работает</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps(view)}</table>
</td></tr>
<tr><td class="d-card m-px d-line" bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 24px 24px;padding:20px 32px 30px;border-top:0">
${footer(view, "light")}
</td></tr>`;
  return renderDocument({ view, bodyBg: C.page, light: true, css: CSS, body });
}
