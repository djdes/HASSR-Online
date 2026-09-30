import { formatRowSignatures, isSignatureOutdated } from "@/lib/brakerage-commission";
import type { BrakerageQrList, BrakerageQrRow } from "@/lib/brakerage-qr";
import type { BrakerageQrRole } from "@/lib/brakerage-qr-role";
import { esc, renderMessage } from "@/lib/journal-fill-html";

/**
 * Экраны QR бракеража поверх общей QR-формы (серверный HTML, работают без
 * скриптов): вкладки «За сегодня / Добавить», список за сегодня для
 * комиссии и редактора, подтверждение удаления, вход комиссии по PIN.
 */

export function renderBrakerageTabs(params: {
  active: "list" | "add";
  listHref: string;
  addHref: string;
  waiting: number;
  addLabel: string;
}): string {
  const tab = (key: "list" | "add", href: string, label: string) =>
    `<a class="${params.active === key ? "on" : ""}" href="${esc(href)}"${params.active === key ? ` aria-current="page"` : ""}>${esc(label)}</a>`;
  return `<nav class="tabs" aria-label="Режим">${tab("list", params.listHref, params.waiting > 0 ? `За сегодня · ждут ${params.waiting}` : "За сегодня")}${tab("add", params.addHref, params.addLabel)}</nav>`;
}

/** «Одно блюдо / Несколько блюд» над формой добавления. */
export function renderBulkSwitch(params: { bulk: boolean; oneHref: string; bulkHref: string; one: string; many: string }): string {
  return `<nav class="tabs" aria-label="Сколько добавить"><a class="${params.bulk ? "" : "on"}" href="${esc(params.oneHref)}">${esc(params.one)}</a><a class="${params.bulk ? "on" : ""}" href="${esc(params.bulkHref)}">${esc(params.many)}</a></nav>`;
}

function signatureBadge(row: BrakerageQrRow, timeZone: string, isFinished: boolean): string {
  if (row.signatures.length === 0) return `<span class="bk-s wait">Ждёт подписи</span>`;
  // Оценка лежит в своём поле журнала: у готовой продукции — `organoleptic`,
  // у скоропорта — `organolepticResult`. Раньше оценку подставляли в оба, и
  // пустой `organolepticResult` снимка готовой продукции давал «изменено
  // после подписи» сразу после подписи.
  const current = {
    productName: row.name,
    ...(isFinished ? { organoleptic: row.grade } : { organolepticResult: row.grade }),
    releaseAllowed: row.releaseAllowed ?? undefined,
    portionWeight: isFinished ? row.portionWeight : undefined,
  };
  const outdated = row.signatures.some((signature) => isSignatureOutdated(current, signature));
  // Время подписи — как в журнале и печати: бракераж строки + 1 минута.
  const text = formatRowSignatures(row.signatures, timeZone, { rejectionTime: row.rejectionAt });
  return `<span class="bk-s signed">Подписано: ${esc(text)}${outdated ? " · изменено после подписи" : ""}</span>`;
}

function seg(name: string, options: Array<{ value: string; label: string }>, current: string): string {
  return `<div class="seg" role="radiogroup">${options
    .map((option) => {
      const checked = option.value === current;
      return `<label class="segb${checked ? " on" : ""}"><input type="radio" name="${esc(name)}" value="${esc(option.value)}"${checked ? " checked" : ""}><span>${esc(option.label)}</span></label>`;
    })
    .join("")}</div>`;
}

/** Стили карточки списка: подписи полей крупно, значения — рядом. */
const BK_LIST_CSS = `<style>
.bk-f{margin:0 0 12px}
.bk-l{display:block;font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6f7282;margin:0 0 6px 2px}
.bk-v{font-size:19px;font-weight:600;color:#0b1024;margin:0 2px;font-variant-numeric:tabular-nums}
.bk-g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.bk-adm{margin:4px 0 8px}
.bk-adm .segb{min-height:56px;font-size:17px}
.bk-adm .segb.yes:has(input:checked){border-color:#16a34a;background:#ecfdf5;color:#116b2a;box-shadow:0 0 0 3px rgba(22,163,74,.15)}
.bk-adm .segb.no:has(input:checked){border-color:#d2453d;background:#fff4f2;color:#a13a32;box-shadow:0 0 0 3px rgba(210,69,61,.15)}
.bk-viewer{border:1px solid #f4dfb8;background:#fff8eb;color:#a16d32;border-radius:14px;padding:14px;margin:0 0 12px;font-size:15px;line-height:1.45;font-weight:500}
</style>`;

/** Должность комиссии вне утверждённого состава: список только для чтения. */
export const BRAKERAGE_VIEWER_NOTICE =
  "Вас нет в утверждённом составе бракеражной комиссии. Попросите руководителя добавить вас: журнал → «Комиссия».";

function viewerNotice(role: BrakerageQrRole): string {
  return role.viewer && !role.evaluator && !role.editor
    ? `<div class="bk-viewer" role="note" data-viewer-notice>${esc(BRAKERAGE_VIEWER_NOTICE)}</div>`
    : "";
}

/** Время 24 ч: текстовое поле «ЧЧ:ММ» — нативный time на iPhone с английской локалью показывает AM/PM. */
function timeInput(name: string, value: string, label: string): string {
  return `<input class="in" name="${esc(name)}" value="${esc(value)}" inputmode="numeric" maxlength="5" pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]" placeholder="ЧЧ:ММ" aria-label="${esc(label)}" autocomplete="off">`;
}

function field(label: string, control: string): string {
  return `<div class="bk-f"><span class="bk-l">${esc(label)}</span>${control}</div>`;
}

function valueField(label: string, value: string): string {
  return field(label, `<div class="bk-v">${esc(value || "—")}</div>`);
}

/**
 * Список «за сегодня» (решение владельца):
 *   • зав. производством (редактор) видит и правит блюдо, время
 *     изготовления, выход и оценку;
 *   • член комиссии видит то же, правит только оценку и время бракеража и
 *     ставит «Допущено» / «Не допущено» (по умолчанию ничего) — это подпись.
 */
export function renderBrakerageList(params: {
  action: string;
  who: string;
  tabs: string;
  list: BrakerageQrList;
  role: BrakerageQrRole;
  employeeId: string;
  isFinished: boolean;
  timeZone: string;
  addHref: string;
  deleteHref: (rowId: string) => string;
  error?: string | null;
}): string {
  const { list, role } = params;
  const noun = params.isFinished ? "блюд" : "позиций";
  if (list.rows.length === 0) {
    return `${BK_LIST_CSS}${params.who}${params.tabs}${viewerNotice(role)}${renderMessage(
      "muted",
      `За сегодня ${noun} пока нет. Их добавляет повар по этому же QR — или добавьте сами.`,
      `<div class="sticky"><a class="btn" href="${esc(params.addHref)}">Добавить</a></div>`
    )}`;
  }
  const gradeLabel = (value: string) => list.gradeOptions.find((option) => option.value === value)?.label ?? value;
  const productionLabel = params.isFinished ? "Время изготовления" : "Время поступления";
  const cards = list.rows
    .map((row) => {
      const id = row.rowId;
      const mine = row.signatures.find((signature) => signature.userId === params.employeeId);
      const title = role.editor
        ? field(params.isFinished ? "Блюдо" : "Продукт", `<input class="in" name="name:${esc(id)}" value="${esc(row.name)}" maxlength="200" aria-label="Наименование">`)
        : `<div class="bk-n" style="margin:0 2px 10px">${esc(row.name)}</div>`;
      const head = `<div class="bk-h"><div class="bk-t">${row.fromYesterday ? "вчера" : "сегодня"}</div>${signatureBadge(row, params.timeZone, params.isFinished)}</div>`;
      const production = role.editor ? field(productionLabel, timeInput(`time:${id}`, row.time, productionLabel)) : valueField(productionLabel, row.time);
      const output = params.isFinished
        ? role.editor
          ? field("Выход, г", `<input class="in" name="w:${esc(id)}" value="${esc(row.portionWeight)}" inputmode="decimal" maxlength="20" placeholder="например, 250" aria-label="Выход, г">`)
          : valueField("Выход, г", row.portionWeight)
        : "";
      const canGrade = role.editor || role.evaluator;
      const grade = canGrade ? field("Оценка", seg(`grade:${id}`, list.gradeOptions, row.grade)) : valueField("Оценка", gradeLabel(row.grade));
      const rejection =
        params.isFinished && role.evaluator
          ? field("Время бракеража", timeInput(`rej:${id}`, row.rejectionTime, "Время бракеража"))
          : params.isFinished
            ? valueField("Время бракеража", row.rejectionTime)
            : "";
      const admission =
        role.evaluator && params.isFinished
          ? `<p class="bk-sub">${mine ? "Ваше решение (подпишете заново)" : "Ваше решение — это подпись"}</p><div class="seg bk-adm" role="radiogroup"><label class="segb yes"><input type="radio" name="adm:${esc(id)}" value="yes" data-adm><span>Допущено</span></label><label class="segb no"><input type="radio" name="adm:${esc(id)}" value="no" data-adm><span>Не допущено</span></label></div>`
          : "";
      const del = role.editor ? `<a class="bk-del" href="${esc(params.deleteHref(id))}">Удалить строку</a>` : "";
      return `<div class="obj bk">${head}${title}<div class="bk-g2">${production}${params.isFinished ? output : ""}</div>${grade}${rejection}${admission}${del}</div>`;
    })
    .join("");

  const waiting = list.rows.filter((row) => row.signatures.length === 0).length;
  const readOnly = !role.evaluator && !role.editor;
  const lead = role.evaluator
    ? `<p class="today">${waiting > 0 ? `Ждут подписи: <b>${waiting}</b>. ` : "Всё подписано. "}Проверьте блюдо и отметьте «Допущено» или «Не допущено» — это ваша подпись${params.isFinished ? ", в журнале она встанет на минуту позже времени бракеража" : ""}. Оценку и время бракеража можно поправить.</p>`
    : readOnly
      ? `${viewerNotice(role)}<p class="today">${waiting > 0 ? `Ждут подписи: <b>${waiting}</b>. ` : "Всё подписано. "}Блюда за сегодня — только просмотр.</p>`
      : `<p class="today">Проверьте выход, оценку и время изготовления — исправьте, если нужно. Подписывает комиссия.</p>`;
  const buttons = role.evaluator
    ? `<button class="btn" type="submit" name="action" value="save" data-sign-btn>${role.editor ? "Сохранить и подписать" : "Подписать"}</button>`
    : `<button class="btn" type="submit" name="action" value="save">Сохранить изменения</button>`;
  const script = role.evaluator
    ? `<script>(function(){var f=document.getElementById("bk-form");if(!f)return;var b=f.querySelector("[data-sign-btn]");var base=b.textContent;function u(){var n=f.querySelectorAll("[data-adm]:checked").length;b.textContent=n>0?base+" · "+n:base;}f.addEventListener("change",function(e){var t=e.target;if(t&&t.type==="radio"){var g=f.querySelectorAll('input[name="'+t.name+'"]');for(var i=0;i<g.length;i++)g[i].parentNode.classList.toggle("on",g[i].checked);}u();});u();})();</script>`
    : "";
  if (readOnly) {
    // Без формы: ни оценки, ни подписи — только карточки.
    return `${BK_LIST_CSS}${params.who}${params.tabs}${lead}
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
<div id="bk-view">${cards}</div>`;
  }
  return `${BK_LIST_CSS}${params.who}${params.tabs}${lead}
<form method="post" action="${esc(params.action)}" id="bk-form">
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
${cards}
<div class="sticky">${buttons}</div>
</form>${script}`;
}

export function renderBrakerageDeleteConfirm(params: { action: string; rowId: string; rowName: string; signed: boolean; cancelHref: string; who: string }): string {
  return `${params.who}<form method="post" action="${esc(params.action)}" class="card">
<input type="hidden" name="action" value="delete">
<input type="hidden" name="row" value="${esc(params.rowId)}">
<h2>Удалить «${esc(params.rowName)}»?</h2>
<p class="muted" style="margin-top:8px">Строка пропадёт из журнала.${params.signed ? " Она уже подписана комиссией — подпись останется в журнале подписей." : ""}</p>
<div class="sticky"><button class="btn danger" type="submit">Да, удалить</button><a class="btn second" href="${esc(params.cancelHref)}">Отмена</a></div>
</form>`;
}

/** Режим «через вход» без сессии: войти в кабинет или — члену комиссии — по PIN. */
export function renderCommissionGate(params: { loginHref: string; pinHref: string }): string {
  return `<div class="card"><p class="label">Как войти</p><p class="muted">Записи в этом журнале делаются из кабинета. Член сторонней бракеражной комиссии может подписать блюда по своему PIN.</p>
<div class="sticky"><a class="btn" href="${esc(params.loginHref)}">Войти в кабинет</a><a class="btn second" href="${esc(params.pinHref)}">Я член комиссии — войти по PIN</a></div></div>`;
}
