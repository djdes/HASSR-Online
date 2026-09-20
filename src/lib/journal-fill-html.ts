import type { JournalFillHints } from "@/lib/journal-fill-hints";
import { TIME_OFFSET_CHIPS } from "@/lib/journal-fill-hints";
import { suggestionKey, type NameSuggestionMeta } from "@/lib/name-suggestions";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

/**
 * QR-форма журнала как обычный серверный HTML: без React-загрузчика,
 * без общих стилей кабинета, без шрифтов. Страница весит ~15 КБ и
 * работает без JavaScript (ссылки и `<form method="post">`); маленький
 * инлайн-скрипт лишь добавляет удобства (чипы, температура по блюду,
 * подсветка отклонения). Причина: на медленной сети в цехе React-версия
 * оживала через 10 с.
 */

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON для инлайн-скрипта: `</script>` и U+2028/2029 не должны ломать разметку. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export const QR_FILL_CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fafbff;color:#0b1024;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:#3848c7}
.hero{color:#fff;padding:28px 0;background:radial-gradient(circle at 8% 0%,rgba(85,102,246,.55),transparent 55%),radial-gradient(circle at 100% 100%,rgba(122,92,255,.4),transparent 55%),#0b1024}
.wrap{max-width:36rem;margin:0 auto;padding:0 20px}
.hero .top{display:flex;gap:12px;align-items:flex-start}
.hero .ico{flex:none;width:44px;height:44px;border-radius:16px;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.7)}
h1{font-size:22px;line-height:1.2;margin:4px 0 0;font-weight:600;letter-spacing:-.02em}
.sub{margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.78)}
main{padding:24px 0 24px}
.card{background:#fff;border:1px solid #ececf4;border-radius:24px;padding:20px;box-shadow:0 0 0 1px rgba(240,240,250,.45);margin-bottom:16px}
.label{font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#6f7282;margin:0 0 12px}
.list{display:flex;flex-direction:column;gap:8px}
.item{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;padding:10px 16px;border:1px solid #dcdfed;border-radius:16px;background:#fff;color:#0b1024;text-decoration:none;font-weight:500;font-size:15px;line-height:1.3}
.item.on{border-color:#5566f6;background:#eef1ff}
.item.done{border-color:#d4f5e3;background:#f3fdf7;color:#116b2a}
.item small{display:block;font-weight:400;color:#6f7282;font-size:12.5px;margin-top:2px}
.item .arr{flex:none;color:#9b9fb3}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border:0;border-radius:16px;background:#5566f6;color:#fff;font:inherit;font-size:16px;font-weight:600;text-decoration:none;box-shadow:0 10px 30px -12px rgba(85,102,246,.55);cursor:pointer}
.btn:disabled{opacity:.6}
.btn.second{background:#f5f6ff;color:#3848c7;box-shadow:none;border:1px solid rgba(85,102,246,.3);font-weight:500}
.sticky{position:sticky;bottom:0;z-index:5;padding:14px 0 max(env(safe-area-inset-bottom),12px);background:linear-gradient(to top,#fafbff 72%,rgba(250,251,255,0))}
.field{background:#fff;border:1px solid #ececf4;border-radius:16px;padding:14px 16px;margin-bottom:12px}
.field.bad{border-color:#f5a3a3}
.ft{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;font-size:14.5px;font-weight:600;margin-bottom:8px}
.ft .u{font-weight:500;color:#9b9fb3;font-size:12.5px}
.req{display:inline-block;padding:2px 8px;border-radius:999px;background:#ffe4e6;color:#be123c;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.opt{display:inline-block;padding:2px 8px;border-radius:999px;background:#f5f6ff;color:#9b9fb3;font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase}
.in{display:block;width:100%;min-height:52px;border:1px solid #dcdfed;border-radius:16px;padding:12px 16px;font:inherit;font-size:16px;color:#0b1024;background:#fff;-webkit-appearance:none;appearance:none;margin:0}
textarea.in{min-height:96px;resize:vertical}
select.in{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236f7282' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:40px}
input.in[type=time],input.in[type=date]{display:flex;align-items:center;line-height:1.2}
input.in[type=time]{font-weight:600;font-variant-numeric:tabular-nums}
.in:focus{outline:none;border-color:#5566f6;box-shadow:0 0 0 4px rgba(85,102,246,.15)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid #dcdfed;border-radius:999px;background:#fff;color:#3c4053;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.chip.on{border-color:#5566f6;background:#eef1ff;color:#3848c7}
.hint{font-size:12px;color:#9b9fb3;margin:6px 0 0}
.err{border:1px solid #ffd2cd;background:#fff4f2;color:#a13a32;border-radius:16px;padding:12px 16px;font-size:13.5px;margin-bottom:12px}
.warn{border:1px solid #ffe9b0;background:#fff8eb;color:#7a4a00;border-radius:16px;padding:16px;font-size:14px;line-height:1.5}
.muted{color:#6f7282;font-size:14px;line-height:1.5;margin:0}
.who{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:#6f7282;margin:0 0 12px}
.who a{font-weight:500;text-decoration:none}
.who b{color:#0b1024;font-weight:500}
.check{display:flex;align-items:center;gap:12px;min-height:44px;font-size:15px;font-weight:500}
.check input{width:24px;height:24px;margin:0;accent-color:#5566f6}
.dev{border:1px solid #ffd2cd;background:#fff4f2;border-radius:16px;padding:14px 16px;margin-bottom:12px}
.dev b{display:block;color:#a13a32;font-size:14px;margin-bottom:4px}
.dev p{margin:0 0 8px;font-size:13px;color:#7a2e28}
.ok{width:56px;height:56px;border-radius:16px;background:#ecfdf5;color:#116b2a;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
.center{text-align:center}
h2{font-size:22px;letter-spacing:-.02em;margin:0;font-weight:600}
.steps{margin:0 0 12px;padding:0;list-style:none}
.steps li{display:flex;gap:10px;padding:10px 0;border-top:1px solid #ececf4;font-size:14px}
.steps li:first-child{border-top:0}
.steps .n{flex:none;width:24px;height:24px;border-radius:999px;background:#eef1ff;color:#3848c7;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center}
.steps small{display:block;color:#6f7282;margin-top:2px}
[hidden]{display:none!important}
.search{margin-bottom:10px}
`;

/** Инлайн-скрипт: только удобства, страница работает и без него. */
export const QR_FILL_JS = `
(function(){
  function hhmm(d){return (d.getHours()<10?"0":"")+d.getHours()+":"+(d.getMinutes()<10?"0":"")+d.getMinutes();}
  function key(s){return String(s||"").replace(/\\s+/g," ").trim().toLowerCase();}
  document.addEventListener("click",function(e){
    var b=e.target.closest?e.target.closest("[data-fill]"):null; if(!b) return;
    e.preventDefault();
    var el=document.getElementById("f-"+b.getAttribute("data-fill")); if(!el) return;
    var ago=b.getAttribute("data-ago");
    el.value=ago!==null?hhmm(new Date(Date.now()-Number(ago)*60000)):(b.getAttribute("data-value")||"");
    var g=b.parentNode.querySelectorAll("[data-fill]");
    for(var i=0;i<g.length;i++) g[i].classList.toggle("on",g[i]===b);
    var ev=document.createEvent("Event"); ev.initEvent("input",true,true); el.dispatchEvent(ev);
  });
  var meta=window.__qrTemps||{}; var tempKey=window.__qrTempKey; var nameKey=window.__qrNameKey; var auto=false;
  var nameEl=nameKey?document.getElementById("f-"+nameKey):null; var tempEl=tempKey?document.getElementById("f-"+tempKey):null;
  var hintEl=document.getElementById("temp-hint");
  if(nameEl&&tempEl){
    nameEl.addEventListener("input",function(){
      var t=meta[key(nameEl.value)];
      if(t&&(tempEl.value===""||auto)){tempEl.value=t;auto=true;if(hintEl)hintEl.hidden=false;}
      else if(auto&&!t){tempEl.value="";auto=false;if(hintEl)hintEl.hidden=true;}
    });
    tempEl.addEventListener("input",function(){auto=false;if(hintEl)hintEl.hidden=true;});
  }
  var dev=document.getElementById("deviation");
  function checkRange(){
    if(!dev) return; var out=[]; var ins=document.querySelectorAll("input[data-min],input[data-max]");
    for(var i=0;i<ins.length;i++){var v=ins[i].value.replace(",","."); if(v==="") continue; var n=Number(v); if(!isFinite(n)) continue;
      var mn=ins[i].getAttribute("data-min"), mx=ins[i].getAttribute("data-max");
      if((mn!==null&&n<Number(mn))||(mx!==null&&n>Number(mx))) out.push(ins[i].getAttribute("data-label")||"");}
    dev.hidden=out.length===0; var t=document.getElementById("deviation-title"); if(t&&out.length) t.textContent=out.join(", ")+" — вне нормы";
  }
  document.addEventListener("input",function(e){ if(e.target&&e.target.hasAttribute&&(e.target.hasAttribute("data-min")||e.target.hasAttribute("data-max"))) checkRange(); });
  checkRange();
  var form=document.getElementById("qr-form");
  if(form) form.addEventListener("submit",function(){ var b=form.querySelector("button[type=submit]"); if(b){b.disabled=true;b.textContent="Сохраняем…";} });
  var q=document.getElementById("emp-search");
  if(q){ q.addEventListener("input",function(){ var s=key(q.value); var it=document.querySelectorAll("[data-emp]"); for(var i=0;i<it.length;i++){ it[i].hidden=s!==""&&key(it[i].getAttribute("data-emp")).indexOf(s)===-1; } }); }
})();
`;

const QR_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>`;
const ARROW = `<span class="arr" aria-hidden="true">›</span>`;
const CHECK_ICON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;

export function renderPage(params: {
  orgName: string;
  title: string;
  subtitle?: string | null;
  body: string;
  script?: string | null;
  withJs?: boolean;
}): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0b1024">
<title>${esc(params.title)} — ${esc(params.orgName)}</title>
<style>${QR_FILL_CSS}</style>
</head>
<body>
<header class="hero"><div class="wrap"><div class="top"><div class="ico">${QR_ICON}</div><div>
<div class="eyebrow">${esc(params.orgName)}</div>
<h1>${esc(params.title)}</h1>
${params.subtitle ? `<p class="sub">${esc(params.subtitle)}</p>` : ""}
</div></div></div></header>
<main><div class="wrap">
${params.body}
</div></main>
${params.script ? `<script>${params.script}</script>` : ""}
${params.withJs === false ? "" : `<script>${QR_FILL_JS}</script>`}
</body>
</html>`;
}

export function renderMessage(kind: "error" | "warn" | "muted", text: string, extra?: string): string {
  if (kind === "error") return `<div class="card"><div class="err">${esc(text)}</div>${extra ?? ""}</div>`;
  if (kind === "warn") return `<div class="warn">${esc(text)}</div>${extra ?? ""}`;
  return `<div class="card"><p class="muted">${esc(text)}</p>${extra ?? ""}</div>`;
}

export function renderInvalidLink(orgName = "WeSetup"): string {
  return renderPage({
    orgName,
    title: "Ссылка недействительна",
    body: `<div class="card center"><p class="muted">Плакат повреждён или не подходит к этой организации. Попросите руководителя распечатать плакат заново.</p></div>`,
    withJs: false,
  });
}

export function renderHub(items: Array<{ code: string; name: string; href: string }>): string {
  if (items.length === 0) return renderMessage("warn", "Сегодня нет ни одного активного документа. Попросите руководителя открыть журналы на этот период.");
  return `<div class="card"><p class="label">Что заполнить</p><div class="list">${items
    .map((item) => `<a class="item" href="${esc(item.href)}"><span>${esc(item.name)}</span>${ARROW}</a>`)
    .join("")}</div></div>`;
}

export function renderDocumentStep(params: {
  documents: Array<{ id: string; title: string; building: string | null; href: string }>;
}): string {
  return `<div class="card"><p class="label">Какой документ</p><div class="list">${params.documents
    .map((doc) => `<a class="item" href="${esc(doc.href)}"><span>${esc(doc.title)}${doc.building ? `<small>${esc(doc.building)}</small>` : ""}</span>${ARROW}</a>`)
    .join("")}</div></div>`;
}

export function renderEmployeeStep(params: {
  employees: Array<{ id: string; name: string; positionTitle: string | null; href: string }>;
  remembered: { id: string; name: string; positionTitle: string | null; href: string } | null;
  hintText: string;
}): string {
  const remembered = params.remembered
    ? `<div class="card"><p class="label">Вы</p><a class="item on" href="${esc(params.remembered.href)}"><span>${esc(params.remembered.name)}${params.remembered.positionTitle ? `<small>${esc(params.remembered.positionTitle)}</small>` : ""}</span>${ARROW}</a><div class="sticky"><a class="btn" href="${esc(params.remembered.href)}">Продолжить</a></div></div>`
    : "";
  const search = params.employees.length > 12 ? `<div class="search"><input id="emp-search" class="in" type="search" placeholder="Найти по фамилии" autocomplete="off"></div>` : "";
  return `${remembered}<div class="card"><p class="label">${params.remembered ? "Или другой сотрудник" : "Кто заполняет"}</p>${search}<div class="list">${params.employees
    .map(
      (item) =>
        `<a class="item${params.remembered?.id === item.id ? " on" : ""}" data-emp="${esc(item.name)}" href="${esc(item.href)}"><span>${esc(item.name)}${item.positionTitle ? `<small>${esc(item.positionTitle)}</small>` : ""}</span>${ARROW}</a>`
    )
    .join("")}</div><p class="hint">${esc(params.hintText)}</p></div>`;
}

export function renderPinStep(params: { action: string; employeeName: string; changeHref: string; error?: string | null }): string {
  return `<div class="who"><span>Вы: <b>${esc(params.employeeName)}</b></span><a href="${esc(params.changeHref)}">Сменить</a></div>
<form method="post" action="${esc(params.action)}" class="card" id="qr-form">
<input type="hidden" name="action" value="pin">
<p class="label">Ваш PIN</p>
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
<input class="in" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="••••" required autofocus style="text-align:center;font-size:22px;letter-spacing:.4em">
<p class="hint">PIN выдаёт руководитель. Он подтверждает, что запись сделали именно вы.</p>
<div class="sticky"><button class="btn" type="submit">Продолжить</button></div>
</form>`;
}

export function renderRowStep(params: { rows: Array<{ rowKey: string; label: string; sublabel?: string; mine: boolean; href: string }>; who: string }): string {
  if (params.rows.length === 0) return renderMessage("muted", "В этом документе пока нет строк, которые можно заполнить от вашего имени. Попросите руководителя назначить вас в журнале.");
  return `${params.who}<div class="card"><p class="label">Что именно</p><div class="list">${params.rows
    .map((row) => `<a class="item${row.mine ? " on" : ""}" href="${esc(row.href)}"><span>${esc(row.label)}${row.sublabel ? `<small>${esc(row.sublabel)}</small>` : ""}</span>${ARROW}</a>`)
    .join("")}</div></div>`;
}

export function renderWho(params: { employeeName: string; changeHref: string | null; documentTitle?: string | null; documentChangeHref?: string | null }): string {
  const doc = params.documentTitle
    ? `<p class="who"><span>Документ: <b>${esc(params.documentTitle)}</b></span>${params.documentChangeHref ? `<a href="${esc(params.documentChangeHref)}">Сменить</a>` : ""}</p>`
    : "";
  return `<p class="who"><span>Вы: <b>${esc(params.employeeName)}</b></span>${params.changeHref ? `<a href="${esc(params.changeHref)}">Сменить</a>` : ""}</p>${doc}`;
}

type Suggestions = Record<string, { values: string[]; meta: Record<string, NameSuggestionMeta> }>;

export function renderForm(params: {
  action: string;
  token: string;
  form: TaskFormSchema;
  hints: JournalFillHints;
  values: Record<string, unknown>;
  suggestions: Suggestions;
  who: string;
  error?: string | null;
  badKeys?: string[];
  correction?: string;
  showDeviation?: boolean;
  deviationTitle?: string | null;
  correctionPresets: readonly string[];
  openedAt: number;
}): string {
  const bad = new Set(params.badKeys ?? []);
  const fields = params.form.fields.map((field) => renderField(field, params.values[field.key], params.hints, params.suggestions, bad.has(field.key))).join("");
  const steps = params.form.pipeline && params.form.pipeline.length > 0
    ? `<div class="card"><p class="label">Порядок действий</p><ol class="steps">${params.form.pipeline
        .map((step, index) => `<li><span class="n">${index + 1}</span><span>${esc(step.title)}${step.detail ? `<small>${esc(step.detail)}</small>` : ""}</span></li>`)
        .join("")}</ol></div>`
    : "";
  const hasNumbers = params.form.fields.some((field) => field.type === "number" && (field.min != null || field.max != null));
  const deviation = hasNumbers
    ? `<div class="dev" id="deviation"${params.showDeviation ? "" : " hidden"}><b id="deviation-title">${esc(params.deviationTitle ?? "Значение вне нормы")}</b><p>Напишите, что вы сделали — это попадёт в журнал рядом с записью.</p><textarea class="in" name="__correction" id="f-__correction" rows="2" placeholder="Что сделали">${esc(params.correction ?? "")}</textarea><div class="chips">${params.correctionPresets
        .map((preset) => `<button type="button" class="chip" data-fill="__correction" data-value="${esc(preset)}">${esc(preset)}</button>`)
        .join("")}</div></div>`
    : "";
  return `${params.who}${params.form.intro ? `<p class="muted" style="margin-bottom:14px">${esc(params.form.intro)}</p>` : ""}${steps}
<form method="post" action="${esc(params.action)}" id="qr-form" novalidate>
<input type="hidden" name="action" value="submit">
<input type="hidden" name="__openedAt" value="${params.openedAt}">
${params.error ? `<div class="err">${esc(params.error)}</div>` : ""}
${fields}
${deviation}
<div class="sticky"><button class="btn" type="submit">${esc(params.form.submitLabel ?? "Сохранить")}</button></div>
</form>`;
}

/**
 * Норма для подсветки отклонения: сначала из подписи адаптера
 * («… · норма 2…6»), иначе физические пределы поля (min/max валидатора).
 * У холодильников пределы -40…30, а норма своя у каждого — иначе 12 °C
 * в холодильнике не считалось бы отклонением.
 */
export function normRange(field: TaskFormField): { min: number | null; max: number | null } {
  if (field.type !== "number") return { min: null, max: null };
  const m = /норма\s*(-?\d+(?:[.,]\d+)?)\s*[…–—-]\s*(-?\d+(?:[.,]\d+)?)/i.exec(field.label);
  if (m) {
    const min = Number(m[1].replace(",", "."));
    const max = Number(m[2].replace(",", "."));
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
  }
  return { min: field.min ?? null, max: field.max ?? null };
}

function chips(fieldKey: string, values: readonly string[], current: string): string {
  if (values.length === 0) return "";
  return `<div class="chips">${values
    .map((value) => `<button type="button" class="chip${value === current ? " on" : ""}" data-fill="${esc(fieldKey)}" data-value="${esc(value)}">${esc(value)}</button>`)
    .join("")}</div>`;
}

function renderField(field: TaskFormField, raw: unknown, hints: JournalFillHints, suggestions: Suggestions, bad: boolean): string {
  const id = `f-${field.key}`;
  const value = raw === null || raw === undefined ? "" : String(raw);
  const required = "required" in field && field.required === true;
  const unit = "unit" in field && field.unit ? `<span class="u">${esc(field.unit)}</span>` : "";
  const pill = field.type === "boolean" || field.type === "photo" ? "" : required ? `<span class="req">обязательно</span>` : `<span class="opt">по желанию</span>`;
  const head = `<div class="ft"><label for="${esc(id)}">${esc(field.label)}</label>${unit}${pill}</div>`;
  const wrap = (inner: string) => `<div class="field${bad ? " bad" : ""}">${head}${inner}</div>`;
  const placeholder = "placeholder" in field && field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : "";

  switch (field.type) {
    case "text": {
      const scope = hints.nameFields?.[field.key];
      const list = scope ? (suggestions[scope]?.values ?? []) : [];
      const choices = hints.choices?.[field.key] ?? [];
      if (field.multiline) {
        // Варианты одним касанием и для многострочного поля (органолептика — textarea).
        return wrap(`<textarea class="in" id="${esc(id)}" name="${esc(field.key)}" rows="${choices.length > 0 ? 2 : 3}"${placeholder}${field.maxLength ? ` maxlength="${field.maxLength}"` : ""}>${esc(value)}</textarea>${chips(field.key, choices, value)}`);
      }
      const datalist = list.length > 0 ? `<datalist id="dl-${esc(field.key)}">${list.slice(0, 50).map((item) => `<option value="${esc(item)}"></option>`).join("")}</datalist>` : "";
      const isTemp = hints.tempField?.tempKey === field.key;
      return wrap(
        `<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" value="${esc(value)}"${placeholder}${field.maxLength ? ` maxlength="${field.maxLength}"` : ""}${list.length > 0 ? ` list="dl-${esc(field.key)}" autocomplete="off"` : ""}>${datalist}${chips(field.key, list.slice(0, 6), value)}${chips(field.key, choices, value)}${isTemp ? `<p class="hint" id="temp-hint" hidden>Подставлено по прошлой записи этого блюда — поправьте, если сегодня иначе.</p>` : ""}`
      );
    }
    case "number": {
      const norm = normRange(field);
      const labelHasNorm = /норма/i.test(field.label);
      const range = labelHasNorm ? "" : norm.min != null && norm.max != null ? `<p class="hint">Норма: ${esc(norm.min)}…${esc(norm.max)}${field.unit ? ` ${esc(field.unit)}` : ""}</p>` : norm.min != null ? `<p class="hint">Не ниже ${esc(norm.min)}</p>` : norm.max != null ? `<p class="hint">Не выше ${esc(norm.max)}</p>` : "";
      const isTemp = hints.tempField?.tempKey === field.key;
      return wrap(
        `<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" inputmode="decimal" value="${esc(value)}"${placeholder}${norm.min != null ? ` data-min="${esc(norm.min)}"` : ""}${norm.max != null ? ` data-max="${esc(norm.max)}"` : ""} data-label="${esc(field.label.replace(/\s*·\s*норма.*$/i, ""))}">${range}${isTemp ? `<p class="hint" id="temp-hint" hidden>Подставлено по прошлой записи этого блюда — поправьте, если сегодня иначе.</p>` : ""}`
      );
    }
    case "boolean": {
      const checked = raw === true || raw === "on" || raw === "true";
      return `<div class="field${bad ? " bad" : ""}"><label class="check"><input type="checkbox" id="${esc(id)}" name="${esc(field.key)}" value="on"${checked ? " checked" : ""}><span>${esc(field.label)}</span></label></div>`;
    }
    case "select":
      return wrap(
        `<select class="in" id="${esc(id)}" name="${esc(field.key)}">${value === "" ? `<option value="">Выберите</option>` : ""}${field.options
          .map((option) => `<option value="${esc(option.value)}"${option.value === value ? " selected" : ""}>${esc(option.label)}</option>`)
          .join("")}</select>`
      );
    case "date":
      return wrap(`<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="date" value="${esc(value)}">`);
    case "time": {
      const offsets = hints.timeOffsetFields?.includes(field.key)
        ? `<div class="chips">${[...TIME_OFFSET_CHIPS, { minutes: 0, label: "Сейчас" }]
            .map((chip) => `<button type="button" class="chip" data-fill="${esc(field.key)}" data-ago="${chip.minutes}">${esc(chip.label)}</button>`)
            .join("")}</div>`
        : "";
      return wrap(`<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="time" step="60" value="${esc(value)}"${placeholder}>${offsets}`);
    }
    case "photo":
      return `<div class="field"><div class="ft"><span>${esc(field.label)}</span><span class="opt">в кабинете</span></div><p class="hint">Фото к этой записи можно приложить в кабинете или в приложении.</p></div>`;
    case "signature":
      return wrap(`<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" value="${esc(value)}" placeholder="Фамилия и инициалы" autocomplete="name">`);
    default:
      return "";
  }
}

export function renderResult(params: {
  mode: "appended" | "updated";
  documentTitle: string;
  employeeName: string;
  timeLabel: string;
  addMoreHref: string | null;
  daily: Array<{ code: string; name: string; filled: boolean; href: string }>;
}): string {
  const pending = params.daily.filter((item) => !item.filled);
  const dailyBlock =
    params.daily.length > 0
      ? `<div class="card"><p class="label">Сегодня у вас</p><div class="list">${params.daily
          .map((item) =>
            item.filled
              ? `<span class="item done"><span>${esc(item.name)}</span><small>отмечено</small></span>`
              : `<a class="item" href="${esc(item.href)}"><span>${esc(item.name)}</span>${ARROW}</a>`
          )
          .join("")}</div>${
          pending.length > 0
            ? `<div class="sticky"><a class="btn second" href="${esc(pending[0].href)}">Дальше: ${esc(pending[0].name)}</a></div>`
            : `<p class="hint center" style="color:#116b2a">Все ежедневные отметки на сегодня сделаны.</p>`
        }</div>`
      : "";
  return `<div class="card center"><div class="ok">${CHECK_ICON}</div><h2>${params.mode === "appended" ? "Строка добавлена" : "Отметка записана"}</h2><p class="muted" style="margin-top:8px">${esc(params.documentTitle)} · ${esc(params.employeeName)} · ${esc(params.timeLabel)}</p>${
    params.addMoreHref ? `<div class="sticky"><a class="btn" href="${esc(params.addMoreHref)}">Добавить ещё</a></div>` : ""
  }</div>${dailyBlock}`;
}

/** Мета температуры по блюдам для инлайн-скрипта: `{ "борщ": "75" }`. */
export function tempMetaScript(hints: JournalFillHints, suggestions: Suggestions): string | null {
  if (!hints.tempField) return null;
  const scope = hints.nameFields?.[hints.tempField.nameKey];
  if (!scope) return null;
  const meta = suggestions[scope]?.meta ?? {};
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value.productTemp) map[suggestionKey(key)] = value.productTemp;
  }
  return `window.__qrTemps=${jsonForScript(map)};window.__qrTempKey=${jsonForScript(hints.tempField.tempKey)};window.__qrNameKey=${jsonForScript(hints.tempField.nameKey)};`;
}
