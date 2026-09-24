import { HEALTH_CONFIRMATIONS, type DayMark } from "@/lib/health-qr";
import { ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE } from "@/lib/hygiene-admission";
import { signatureMark, type HygieneV2View } from "@/lib/hygiene-v2";
import { esc } from "@/lib/journal-fill-html";

/**
 * Экраны QR «Гигиена и здоровье» (серверный HTML, работают без скриптов).
 * Крупно — для людей со слабым зрением: шрифт 20–22px, строки-кнопки от
 * 72px на всю ширину, галка 34px, высокий контраст.
 */
const HEALTH_CSS = `<style>
.hq-lead{font-size:20px;line-height:1.35;font-weight:600;color:#0b1024;margin:2px 2px 12px}
.hq-list{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.hq-item{display:flex;align-items:center;gap:14px;min-height:72px;padding:12px 16px;border:2px solid #dcdfed;border-radius:18px;background:#fff;font-size:21px;line-height:1.3;font-weight:600;color:#0b1024;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background .15s}
.hq-item input{flex:none;width:34px;height:34px;margin:0;accent-color:#116b2a}
.hq-item:has(input:checked){border-color:#16a34a;background:#f0fdf4}
.hq-note{font-size:17px;line-height:1.4;color:#3c4053;margin:0 2px 12px}
.hq-done{border:2px solid #bbf7d0;background:#f0fdf4;color:#116b2a;border-radius:18px;padding:14px 16px;font-size:19px;font-weight:600;margin-bottom:12px}
.hq-bad{border:2px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:18px;padding:16px;font-size:19px;line-height:1.4;margin-bottom:12px}
.hq-bad b{display:block;font-size:22px;margin-bottom:6px}
.hq-row{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid #ececf4;border-radius:16px;background:#fff;margin-bottom:8px}
.hq-row .hq-n{font-size:18px;font-weight:600;color:#0b1024}
.hq-row .hq-s{font-size:15px}
.hq-s.hq-sok{color:#116b2a}.hq-s.hq-sbad{color:#b42318}.hq-s.hq-smiss{color:#9a5b00}.hq-s.hq-soff{color:#6f7282}
.hq-row select{min-height:48px;font-size:16px}
.hq-sum{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.hq-sum span{padding:6px 12px;border-radius:999px;font-size:15px;font-weight:600}
.hq-warn{border:2px solid #fde68a;background:#fffbeb;color:#7a4a00;border-radius:18px;padding:14px 16px;font-size:18px;line-height:1.4;font-weight:600;margin:0 0 14px}
.hq-sig{font-size:16px;color:#3c4053;margin:2px 0 0;line-height:1.4}
.hq-sig b{font-weight:600}
.hq-row .seg{margin:6px 0 0}
.hq-row .segb{min-height:52px;font-size:17px}
.hq-row .segb.yes:has(input:checked){border-color:#16a34a;background:#ecfdf5;color:#116b2a}
.hq-row .segb.no:has(input:checked){border-color:#d2453d;background:#fff4f2;color:#a13a32}
.hq-row .segb.off{opacity:.5;cursor:not-allowed;background:#f4f5f9;border-style:dashed}
.hq-lock{font-size:15px;line-height:1.4;color:#9a5b00;margin:2px 0 0}
</style>`;

export function renderHealthTabs(params: { active: "me" | "all"; meHref: string; allHref: string; missing: number }): string {
  const tab = (key: "me" | "all", href: string, label: string) =>
    `<a class="${params.active === key ? "on" : ""}" href="${esc(href)}"${params.active === key ? ` aria-current="page"` : ""}>${esc(label)}</a>`;
  return `<nav class="tabs" aria-label="Режим">${tab("me", params.meHref, "Моя отметка")}${tab(
    "all",
    params.allHref,
    params.missing > 0 ? `Допуск сотрудников · ждут ${params.missing}` : "Допуск сотрудников"
  )}</nav>`;
}

export function renderHealthForm(params: {
  action: string;
  who: string;
  tabs: string;
  alreadyAt: string | null;
  alreadyAdmitted: boolean | null;
  error?: string | null;
  writesHealth: boolean;
}): string {
  const items = HEALTH_CONFIRMATIONS.map(
    (item) =>
      `<label class="hq-item"><input type="checkbox" name="c:${esc(item.key)}" value="on" data-hq><span>${esc(item.label)}</span></label>`
  ).join("");
  const already =
    params.alreadyAt !== null
      ? params.alreadyAdmitted
        ? `<div class="hq-done" role="status">Вы уже отметились сегодня в ${esc(params.alreadyAt)} — допущен. Если что-то изменилось, отметьте заново.</div>`
        : `<div class="hq-bad" role="status"><b>Сегодня вы не допущены к работе</b>Отметка в ${esc(params.alreadyAt)}. Если всё прошло, отметьте заново.</div>`
      : "";
  const journals = params.writesHealth ? "в гигиенический журнал и журнал здоровья" : "в гигиенический журнал";
  return `${HEALTH_CSS}${params.who}${params.tabs}${already}
<form method="post" action="${esc(params.action)}" id="hq-form">
<input type="hidden" name="action" value="health-submit">
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
<div class="hq-warn" role="note">Каждая отметка — ваша подпись в гигиеническом журнале. За заведомо ложные сведения о своём здоровье отвечает сотрудник: это нарушение санитарных правил.</div>
<p class="hq-lead">Подписываю:</p>
<div class="hq-list">${items}</div>
<p class="hq-note">Отметьте то, что верно. Если что-то не так — не отмечайте: заведующий производством узнает сразу и решит о допуске. Запишется ${journals}.</p>
<div class="sticky"><button class="btn" type="submit">Подписать</button></div>
</form>`;
}

export function renderHealthSuspended(params: { who: string; complaints: string[]; timeLabel: string; backHref: string }): string {
  return `${HEALTH_CSS}${params.who}<div class="hq-bad" role="status" aria-live="polite"><b>Сегодня вы не допущены к работе</b>Причина: ${esc(
    params.complaints.join(", ")
  )}.<br>Заведующий производством уже получил уведомление — дождитесь его решения. Отметка записана в ${esc(params.timeLabel)}.</div>
<div class="sticky"><a class="btn second" href="${esc(params.backHref)}">Исправить отметку</a></div>`;
}

const MARK_TEXT = (mark: DayMark): { cls: string; text: string } => {
  switch (mark.state) {
    case "admitted":
      return { cls: "hq-sok", text: `✓ допущен${mark.at ? ` · ${mark.at}` : ""}` };
    case "suspended":
      return { cls: "hq-sbad", text: `⚠ не допущен${mark.at ? ` · ${mark.at}` : ""}` };
    case "absent":
      return { cls: "hq-soff", text: mark.label };
    default:
      return { cls: "hq-smiss", text: "не отметился" };
  }
};

export type HealthDayRow = {
  id: string;
  name: string;
  position: string | null;
  mark: DayMark;
  hygiene: HygieneV2View;
  /**
   * Сотрудник сегодня сам ответил на вопросы о здоровье
   * (`hasHealthAnswer`). Без ответа «Допущен» недоступен. Не задано —
   * по подписям в `hygiene`.
   */
  answered?: boolean;
};

const SIGNATURE_SHORT: ReadonlyArray<{ key: keyof HygieneV2View["signatures"]; label: string }> = [
  { key: "temperature", label: "t° до 37" },
  { key: "infection", label: "нет инфекций" },
  { key: "respiratorySkin", label: "нет ОРВИ и кожных" },
];

const ABSENCE_OPTIONS = [
  { value: "day_off", label: "Выходной" },
  { value: "sick_leave", label: "Болен" },
  { value: "vacation", label: "Отпуск" },
] as const;

/**
 * Допуск сотрудников (второй QR и вкладка ответственного): подписи
 * сотрудника по трём графам и решение «Допущен / Отстранён» — подпись
 * ответственного в журнале. Отсутствующих отмечают в списке ниже.
 */
export function renderHealthDay(params: {
  action: string;
  who: string;
  tabs: string;
  rows: HealthDayRow[];
  error?: string | null;
  saved?: number | null;
}): string {
  const waiting = (row: HealthDayRow) => row.hygiene.declared && !row.hygiene.result && !row.hygiene.absence;
  const count = (test: (row: HealthDayRow) => boolean) => params.rows.filter(test).length;
  const summary = `<div class="hq-sum"><span style="background:#eef1ff;color:#3848c7">ждут допуска ${count(waiting)}</span><span style="background:#fff8eb;color:#9a5b00">не отметились ${count(
    (row) => row.mark.state === "missing"
  )}</span><span style="background:#f0fdf4;color:#116b2a">допущено ${count((row) => row.hygiene.result?.result === "admitted")}</span><span style="background:#fef2f2;color:#b42318">отстранено ${count(
    (row) => row.hygiene.result?.result === "suspended"
  )}</span></div>`;
  // Сверху — кому нужно решение: ждут допуска, не допущены сами, не отметились.
  const rank = (row: HealthDayRow) =>
    waiting(row) ? 0 : row.mark.state === "suspended" && !row.hygiene.result ? 1 : row.mark.state === "missing" ? 2 : row.hygiene.absence ? 4 : 3;
  const rows = [...params.rows]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"))
    .map((row) => {
      const h = row.hygiene;
      const signatures = h.declared
        ? `<p class="hq-sig">Подписи: ${SIGNATURE_SHORT.map(
            (item) => `<b style="color:${h.signatures[item.key] === true ? "#116b2a" : "#b42318"}">${esc(signatureMark(h.signatures[item.key]) || "—")}</b> ${esc(item.label)}`
          ).join(" · ")}${h.declaredAt ? ` · ${esc(h.declaredAt)}` : ""}</p>`
        : "";
      const mark = MARK_TEXT(row.mark);
      const state = h.result
        ? `<div class="hq-s ${h.result.result === "admitted" ? "hq-sok" : "hq-sbad"}">${h.result.result === "admitted" ? "✓ допущен" : "⚠ отстранён"} · ${esc(h.result.byName)} · ${esc(h.result.at)}</div>`
        : h.absence
          ? `<div class="hq-s hq-soff">${esc(mark.text)}</div>`
          : h.declared
            ? `<div class="hq-s ${row.mark.state === "suspended" ? "hq-sbad" : "hq-smiss"}">${row.mark.state === "suspended" ? "⚠ отметил жалобы — ждёт решения" : "ждёт допуска"}</div>`
            : `<div class="hq-s ${mark.cls}">${esc(mark.text)}</div>`;
      const checked = (value: "admitted" | "suspended") => h.result?.result === value;
      // «Допущен» — только после ответа сотрудника о здоровье (пожелание
      // РПН); уже поставленный допуск не снимаем, «Отстранён» — всегда.
      const admitLocked = !(row.answered ?? h.declared) && !checked("admitted");
      const lockReason = `Допуск недоступен: ${ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE.toLowerCase()}.`;
      const admitLabel = admitLocked
        ? `<label class="segb yes off" aria-disabled="true" title="${esc(lockReason)}"><input type="radio" name="st:${esc(row.id)}" value="admitted" disabled><span>Допущен</span></label>`
        : `<label class="segb yes${checked("admitted") ? " on" : ""}"><input type="radio" name="st:${esc(row.id)}" value="admitted"${checked("admitted") ? " checked" : ""}><span>Допущен</span></label>`;
      const seg = `<div class="seg" role="radiogroup" aria-label="Допуск: ${esc(row.name)}">${admitLabel}<label class="segb no${checked("suspended") ? " on" : ""}"><input type="radio" name="st:${esc(row.id)}" value="suspended"${checked("suspended") ? " checked" : ""}><span>Отстранён</span></label></div>`;
      const absence = `<select class="in" name="ab:${esc(row.id)}" aria-label="Нет на смене: ${esc(row.name)}"><option value="">На смене</option>${ABSENCE_OPTIONS.map(
        (item) => `<option value="${item.value}"${h.absence === item.value ? " selected" : ""}>${item.label}</option>`
      ).join("")}</select>`;
      const lock = admitLocked && !h.absence ? `<p class="hq-lock" data-admit-locked>${esc(lockReason)}</p>` : "";
      return `<div class="hq-row"><div><div class="hq-n">${esc(row.name)}</div>${row.position ? `<div class="hint" style="margin:0">${esc(row.position)}</div>` : ""}${signatures}${state}</div>${seg}${lock}${absence}</div>`;
    })
    .join("");
  const saved =
    params.saved != null && params.saved > 0
      ? `<div class="hq-done" role="status">Сохранено: ${params.saved}. Ваша подпись стоит в журнале.</div>`
      : "";
  return `${HEALTH_CSS}${params.who}${params.tabs}${saved}${summary}
<form method="post" action="${esc(params.action)}">
<input type="hidden" name="action" value="health-keeper">
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
<p class="hq-note">Осмотрите сотрудника и отметьте «Допущен» или «Отстранён» — это ваша подпись ответственного в гигиеническом журнале. «Допущен» доступен, когда сотрудник сам ответил на вопросы о здоровье по QR журнала. Кого нет на смене — выберите «Выходной», «Болен» или «Отпуск».</p>
${rows || `<div class="card"><p class="muted">Сегодня в списке никого нет.</p></div>`}
<div class="sticky"><button class="btn" type="submit">Подписать допуск</button></div>
</form>`;
}
