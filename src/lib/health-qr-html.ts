import { HEALTH_CONFIRMATIONS, KEEPER_STATUSES, type DayMark } from "@/lib/health-qr";
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
</style>`;

export function renderHealthTabs(params: { active: "me" | "all"; meHref: string; allHref: string; missing: number }): string {
  const tab = (key: "me" | "all", href: string, label: string) =>
    `<a class="${params.active === key ? "on" : ""}" href="${esc(href)}"${params.active === key ? ` aria-current="page"` : ""}>${esc(label)}</a>`;
  return `<nav class="tabs" aria-label="Режим">${tab("me", params.meHref, "Моя отметка")}${tab(
    "all",
    params.allHref,
    params.missing > 0 ? `Все за сегодня · нет ${params.missing}` : "Все за сегодня"
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
<p class="hq-lead">Подтверждаю:</p>
<div class="hq-list">${items}</div>
<p class="hq-note">Отметьте то, что верно. Если что-то не так — не отмечайте: заведующая узнает сразу. Запишется ${journals}.</p>
<div class="sticky"><button class="btn" type="submit">Сохранить</button></div>
</form>`;
}

export function renderHealthSuspended(params: { who: string; complaints: string[]; timeLabel: string; backHref: string }): string {
  return `${HEALTH_CSS}${params.who}<div class="hq-bad" role="status" aria-live="polite"><b>Сегодня вы не допущены к работе</b>Причина: ${esc(
    params.complaints.join(", ")
  )}.<br>Заведующая уже получила уведомление — дождитесь её решения. Отметка записана в ${esc(params.timeLabel)}.</div>
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

export function renderHealthDay(params: {
  action: string;
  who: string;
  tabs: string;
  rows: Array<{ id: string; name: string; position: string | null; mark: DayMark }>;
  error?: string | null;
}): string {
  const count = (state: DayMark["state"]) => params.rows.filter((row) => row.mark.state === state).length;
  const summary = `<div class="hq-sum"><span style="background:#f0fdf4;color:#116b2a">допущено ${count("admitted")}</span><span style="background:#fff8eb;color:#9a5b00">не отметились ${count(
    "missing"
  )}</span><span style="background:#fef2f2;color:#b42318">не допущено ${count("suspended")}</span></div>`;
  const options = (current: DayMark) =>
    `<option value="">— не менять —</option>${KEEPER_STATUSES.map(
      (item) =>
        `<option value="${esc(item.value)}"${
          (current.state === "admitted" && item.value === "healthy") || (current.state === "suspended" && item.value === "suspended") ? " selected" : ""
        }>${esc(item.label)}</option>`
    ).join("")}`;
  // Сверху — кому нужно внимание: не допущен, не отметился.
  const order: Record<DayMark["state"], number> = { suspended: 0, missing: 1, admitted: 2, absent: 3 };
  const rows = [...params.rows]
    .sort((a, b) => order[a.mark.state] - order[b.mark.state] || a.name.localeCompare(b.name, "ru"))
    .map((row) => {
      const mark = MARK_TEXT(row.mark);
      return `<div class="hq-row"><div><div class="hq-n">${esc(row.name)}</div>${row.position ? `<div class="hint" style="margin:0">${esc(row.position)}</div>` : ""}<div class="hq-s ${mark.cls}">${esc(
        mark.text
      )}</div></div><select class="in" name="st:${esc(row.id)}" aria-label="Статус: ${esc(row.name)}">${options(row.mark)}</select></div>`;
    })
    .join("");
  return `${HEALTH_CSS}${params.who}${params.tabs}${summary}
<form method="post" action="${esc(params.action)}">
<input type="hidden" name="action" value="health-keeper">
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
<p class="hq-note">Поправьте статус, если сотрудник ошибся или отметить его нужно вам (выходной, болен). В журнале останется, кто исправил.</p>
${rows || `<div class="card"><p class="muted">Сегодня в списке никого нет.</p></div>`}
<div class="sticky"><button class="btn" type="submit">Сохранить изменения</button></div>
</form>`;
}
