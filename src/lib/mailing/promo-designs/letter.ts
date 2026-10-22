import { C, FONT, MONO, button, e, footer, logo, renderDocument, type PromoMailView } from "./shared";

/**
 * «Личное письмо»: самое «человеческое» — белая страница, колонка 520 px,
 * обращение по имени, абзацы, предложение в лиде подсвечено маркером
 * (в Apple Mail маркер «проявляется» анимацией), промокод в тексте
 * моноширинным, обычная кнопка, подпись команды и P.S. со сроком.
 * Без тяжёлых блоков — лучшая доставляемость.
 */

const CSS = `
.mark{background-image:linear-gradient(transparent 58%,#c9f7e4 58%);background-repeat:no-repeat;background-size:100% 100%;animation:mark-in 1.1s ease-out .5s both}
@keyframes mark-in{from{background-size:0 100%}to{background-size:100% 100%}}
@media only screen and (max-width:480px){
.lt-pad{padding:28px 20px 8px!important}
}
@media (prefers-color-scheme:dark){
.mark{background-image:linear-gradient(transparent 58%,#1f6b4f 58%)!important;color:#ffffff!important}
.lt-code{background:#1d2650!important;color:#c9d1ff!important}
}
`;

// Служебные знаки вместо тегов: текст проходит через escapeHtml, потом знаки превращаются в `<span>`.
const MARK_OPEN = "";
const MARK_CLOSE = "";

function paragraphs(view: PromoMailView): string {
  const lead = view.fill(view.leadTemplate, { offer: `${MARK_OPEN}${view.fill("{offer}")}${MARK_CLOSE}` });
  const style = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:27px;color:${C.body}`;
  return lead
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const html = e(p).replace(/\n/g, "<br>").split(MARK_OPEN).join(`<span class="mark" style="background-image:linear-gradient(transparent 58%,#c9f7e4 58%);color:${C.ink};font-weight:700">`).split(MARK_CLOSE).join("</span>");
      return `<p class="d-body" style="${style}">${html}</p>`;
    })
    .join("");
}

export function renderLetter(view: PromoMailView): string {
  const code = `<span class="lt-code" style="padding:2px 8px;border-radius:6px;background:${C.tintB};font-family:${MONO};font-size:15px;font-weight:700;letter-spacing:.06em;color:${C.indigoDeep}">${e(view.code)}</span>`;
  const benefits =
    view.benefits.length > 0
      ? `<p class="d-body" style="margin:0 0 6px;font-family:${FONT};font-size:16px;line-height:27px;color:${C.body}">В подписку входит:</p>
<ul style="margin:0 0 20px;padding:0 0 0 22px;font-family:${FONT};font-size:16px;line-height:27px;color:${C.body}">${view.benefits.map((b) => `<li class="d-body" style="margin:0 0 2px;color:${C.body}">${e(b)}</li>`).join("")}</ul>`
      : "";
  const body = `
<tr><td class="d-card lt-pad m-px" bgcolor="#ffffff" style="background:#ffffff;padding:36px 20px 8px">
<div style="margin:0 0 28px">${logo(view, "dark-on-light", 24)}</div>
<h1 class="d-ink" style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:800;color:${C.ink}">${e(view.headline)}</h1>
${paragraphs(view)}
<p class="d-body" style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:27px;color:${C.body}">Промокод: ${code}${view.endsLabel ? ` — действует ${e(view.until)}` : ""}. Он уже в кнопке ниже.</p>
${benefits}
${button({ href: view.ctaUrl, label: view.buttonText, bg: C.indigo, height: 50, radius: 12 })}
</td></tr>
<tr><td class="d-card m-px" bgcolor="#ffffff" style="background:#ffffff;padding:30px 20px 0">
<p class="d-body" style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:27px;color:${C.body}">Если удобнее — ответьте на это письмо, поможем с оплатой.</p>
<p class="d-ink" style="margin:0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.ink}">С уважением,<br><b>Команда WeSetup</b></p>
<p class="d-muted" style="margin:22px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted}">P.S. Предложение действует ${e(view.until)}.</p>
</td></tr>
<tr><td class="d-card m-px d-line" bgcolor="#ffffff" style="background:#ffffff;padding:30px 20px 36px">
<div style="border-top:1px solid ${C.line};padding-top:18px" class="d-line">${footer(view, "light")}</div>
</td></tr>`;
  return renderDocument({ view, bodyBg: "#ffffff", light: true, css: CSS, body, width: 560 });
}
