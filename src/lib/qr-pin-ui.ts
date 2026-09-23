/**
 * Галка успеха QR-страниц (2026-09-23): залитый сине-зелёный круг #059669
 * с белой галкой и мягким ореолом. Раньше был зелёный КОНТУРНЫЙ круг на
 * светло-зелёном фоне — сотрудники путали его с логотипом Сбербанка
 * («вы что, в мой Сбербанк зашли?»). Одна разметка и один CSS на всех:
 * «PIN верный» (`QR_PIN_OK_HTML`), «Записано» в React (`SuccessCheck`) и
 * серверные страницы журналов (`journal-fill-html.ts`).
 *
 * Размер задаётся переменной `--qc` на `.qc` (по умолчанию 112px). Ореол —
 * `box-shadow` 10px: контейнеру нужен отступ ≥ 10px, иначе ореол режется.
 * При `prefers-reduced-motion` — без анимации, сразу готовая галка.
 */
export const QR_CHECK_COLOR = "#059669";

/** Белая галка без круга: круг — фон `.qc`. Толщина линии 3 (viewBox 24). */
export const QR_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="qc-m" d="m6.5 12.5 3.6 3.6 7.4-7.6"/></svg>`;

export const QR_CHECK_CSS = `
.qc{--qc:112px;width:var(--qc);height:var(--qc);flex:none;border-radius:50%;background:${QR_CHECK_COLOR};box-shadow:0 0 0 10px rgba(5,150,105,.14);display:flex;align-items:center;justify-content:center;animation:qc-pop .42s cubic-bezier(.2,.9,.3,1.25) both}
.qc svg{width:58%;height:58%;display:block}
.qc-m{stroke-dasharray:18;stroke-dashoffset:18;animation:qc-draw .28s ease-out .2s forwards}
@keyframes qc-pop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes qc-draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.qc,.qc-m{animation:none;stroke-dashoffset:0}}
`;

/** Готовая галка: `<div class="qc">…</div>`. `size` — диаметр круга в px. */
export function qrCheckHtml(params: { size?: number; label?: string } = {}): string {
  const style = params.size ? ` style="--qc:${Math.round(params.size)}px"` : "";
  const aria = params.label ? ` role="status" aria-label="${params.label.replace(/[&"<>]/g, "")}"` : ` aria-hidden="true"`;
  return `<div class="qc"${style}${aria}>${QR_CHECK_SVG}</div>`;
}

/** Галка экрана «Записано» (112px) для HTML-страниц; нужен `QR_CHECK_CSS` (он же внутри `QR_PIN_UI_CSS`). */
export const QR_SUCCESS_CHECK_HTML = `<div class="qc-wrap">${qrCheckHtml({ size: 112 })}</div>`;

/**
 * Шаг «Ваш PIN» и зелёная галочка после верного PIN — один CSS для
 * серверных QR-страниц журналов (`journal-fill-html.ts`, работает без JS)
 * и React-страниц помещений/холодильников (`QrPageShell`). Классы с
 * префиксом `qp-`, чтобы не пересекаться со стилями кабинета.
 *
 * Галочка короткая (~0,5 c: как разблокировка телефона) и сама схлопывается;
 * поля формы в это же время всплывают снизу (`.qp-rise`) — ждать не нужно.
 */
export const QR_PIN_UI_CSS = `
.qp-card{background:#fff;border:1px solid #ececf4;border-radius:20px;padding:14px 16px;margin:0 0 16px;box-shadow:0 0 0 1px rgba(240,240,250,.45)}
.qp-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:6px 2px 12px}
.qp-k{font-size:24px;font-weight:700;color:#0b1024;letter-spacing:-.01em}
.qp-link{flex:none;font-size:17px;font-weight:600;color:#3848c7;text-decoration:underline;text-underline-offset:3px}
.qp-pin{display:block;width:100%;min-height:120px;border:2px solid #dcdfed;border-radius:22px;background:#fff;color:#0b1024;text-align:center;font:inherit;font-size:clamp(44px,13vw,64px);font-weight:700;letter-spacing:.25em;padding:0 0 0 .25em;-webkit-appearance:none;appearance:none;margin:0}
.qp-pin::placeholder{color:#c8cbe0;letter-spacing:.2em}
.qp-pin:focus{outline:none;border-color:#5566f6;box-shadow:0 0 0 5px rgba(85,102,246,.15)}
.qp-hint{font-size:20px;line-height:1.4;color:#6f7282;margin:12px 2px 0}
.qp-err{border:1px solid #ffd2cd;background:#fff4f2;color:#a13a32;border-radius:16px;padding:14px 16px;font-size:19px;line-height:1.4;margin:0 0 12px}
.qp-note{border:1px solid #ffe9b0;background:#fff8eb;color:#7a4a00;border-radius:18px;padding:16px 18px;font-size:21px;line-height:1.4;font-weight:500;margin:0 0 14px}
.qp-ok-note{border:1px solid #bbf0d0;background:#ecfdf5;color:#116b2a;border-radius:18px;padding:16px 18px;font-size:20px;line-height:1.4;margin:0 0 14px}
.qp-remember{display:flex;align-items:center;gap:12px;margin:14px 2px 0;font-size:18px;color:#3c4053;cursor:pointer;line-height:1.35}
.qp-remember input{width:26px;height:26px;margin:0;flex:none;accent-color:#5566f6}
.qp-ok{display:flex;justify-content:center;overflow:hidden;max-height:190px;padding:16px 0 18px;margin:0 0 8px;animation:qp-out .3s ease-in .9s forwards}
.qc-wrap{display:flex;justify-content:center;padding:12px 0;margin:0 0 12px}
.qp-rise{animation:qp-rise .35s ease-out .12s both}
@keyframes qp-out{to{max-height:0;opacity:0;margin:0;padding:0}}
@keyframes qp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.qp-rise{animation:none}.qp-ok{animation:qp-out 0s .9s forwards}}
${QR_CHECK_CSS}`;

/** Разметка галочки «PIN верный» — одна для HTML и React (`dangerouslySetInnerHTML`). */
export const QR_PIN_OK_HTML = `<div class="qp-ok" role="status" aria-label="PIN верный">${qrCheckHtml({ size: 120 })}</div>`;

/** Подпись чекбокса «запомнить» — одна на всех QR-страницах. */
export const QR_REMEMBER_LABEL = "Запомнить выбор на этом оборудовании";
