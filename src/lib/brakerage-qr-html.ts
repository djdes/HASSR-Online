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

function signatureBadge(row: BrakerageQrRow, timeZone: string): string {
  if (row.signatures.length === 0) return `<span class="bk-s wait">Ждёт подписи</span>`;
  const outdated = row.signatures.some((signature) =>
    isSignatureOutdated({ productName: row.name, organoleptic: row.grade, organolepticResult: row.grade, releaseAllowed: row.releaseAllowed ?? undefined, portionWeight: row.portionWeight }, signature)
  );
  return `<span class="bk-s signed">Подписано: ${esc(formatRowSignatures(row.signatures, timeZone))}${outdated ? " · изменено после подписи" : ""}</span>`;
}

function seg(name: string, options: Array<{ value: string; label: string }>, current: string): string {
  return `<div class="seg" role="radiogroup">${options
    .map((option) => {
      const checked = option.value === current;
      return `<label class="segb${checked ? " on" : ""}"><input type="radio" name="${esc(name)}" value="${esc(option.value)}"${checked ? " checked" : ""}><span>${esc(option.label)}</span></label>`;
    })
    .join("")}</div>`;
}

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
    return `${params.who}${params.tabs}${renderMessage(
      "muted",
      `За сегодня ${noun} пока нет. Их добавляет повар по этому же QR — или добавьте сами.`,
      `<div class="sticky"><a class="btn" href="${esc(params.addHref)}">Добавить</a></div>`
    )}`;
  }
  const defaultGrade = list.gradeOptions[0]?.value ?? "";
  let toSign = 0;
  const cards = list.rows
    .map((row) => {
      const mine = row.signatures.some((signature) => signature.userId === params.employeeId);
      const signChecked = !mine;
      if (role.evaluator && signChecked) toSign += 1;
      const grade = list.gradeOptions.some((option) => option.value === row.grade) ? row.grade : defaultGrade;
      const when = `${row.time || "время не указано"}${row.fromYesterday ? " · вчера" : ""}`;
      const head = role.editor
        ? `<div class="bk-e"><input class="in" name="name:${esc(row.rowId)}" value="${esc(row.name)}" maxlength="200" aria-label="Наименование"><input class="in" type="time" step="60" name="time:${esc(row.rowId)}" value="${esc(row.time)}" aria-label="Время"></div>`
        : "";
      const title = `<div class="bk-h"><div class="bk-n">${role.editor ? "" : esc(row.name)}<span class="bk-t">${esc(when)}</span></div>${signatureBadge(row, params.timeZone)}</div>`;
      const evaluate = role.evaluator
        ? [
            `<p class="bk-sub">Оценка</p>`,
            seg(`grade:${row.rowId}`, list.gradeOptions, grade),
            params.isFinished
              ? seg(
                  `rel:${row.rowId}`,
                  [
                    { value: "yes", label: "Разрешено" },
                    { value: "no", label: "Не разрешено" },
                  ],
                  row.releaseAllowed ?? "yes"
                )
              : "",
            params.isFinished && list.showPortion
              ? `<input class="in" name="w:${esc(row.rowId)}" value="${esc(row.portionWeight)}" inputmode="decimal" maxlength="20" placeholder="Вес выход, г" aria-label="Вес выход, г">`
              : "",
            `<input class="in" name="note:${esc(row.rowId)}" value="${esc(row.note)}" maxlength="500" placeholder="Примечание" aria-label="Примечание">`,
            `<label class="check"><input type="checkbox" name="sign:${esc(row.rowId)}" value="on" data-sign${signChecked ? " checked" : ""}><span>${mine ? "Подписать заново" : "Подписать"}</span></label>`,
          ].join("")
        : "";
      const del = role.editor ? `<a class="bk-del" href="${esc(params.deleteHref(row.rowId))}">Удалить строку</a>` : "";
      return `<div class="obj bk">${title}${head}${evaluate}${del}</div>`;
    })
    .join("");

  const waiting = list.rows.filter((row) => row.signatures.length === 0).length;
  const lead = role.evaluator
    ? `<p class="today">${waiting > 0 ? `Ждут подписи: <b>${waiting}</b>. ` : "Всё подписано. "}Оцените и отметьте строки — подпись ставится от вашего имени.${role.editor ? " Наименование и время можно исправить." : " Наименование и время меняет повар или заведующая."}</p>`
    : `<p class="today">Исправьте наименование или время, если ошиблись. Оценивает и подписывает комиссия.</p>`;
  const buttons = role.evaluator
    ? `<button class="btn" type="submit" name="action" value="sign" data-sign-btn>Подписать · ${toSign}</button>${
        role.editor ? `<button class="btn second" type="submit" name="action" value="edit">Только сохранить правки</button>` : ""
      }`
    : `<button class="btn" type="submit" name="action" value="edit">Сохранить изменения</button>`;
  const script = role.evaluator
    ? `<script>(function(){var f=document.getElementById("bk-form");if(!f)return;var b=f.querySelector("[data-sign-btn]");function u(){var n=f.querySelectorAll("[data-sign]:checked").length;b.textContent="Подписать · "+n;b.disabled=n===0;}f.addEventListener("change",function(e){var t=e.target;if(t&&t.type==="radio"){var g=f.querySelectorAll('input[name="'+t.name+'"]');for(var i=0;i<g.length;i++)g[i].parentNode.classList.toggle("on",g[i].checked);}u();});u();})();</script>`
    : "";
  return `${params.who}${params.tabs}${lead}
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
