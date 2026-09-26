import { normFromLabel, quickValues } from "@/lib/quick-values";
import {
  COLD_EQUIPMENT_STATUSES,
  COLD_EQUIPMENT_STATUS_SHORT,
  COLD_EQUIPMENT_STATUS_TITLE,
  parseColdEquipmentStatus,
  type ColdEquipmentStatus,
} from "@/lib/cold-equipment-document";
import { OFF_NOTE_EQUIPMENT, OFF_NOTE_READING } from "@/lib/tasksflow-adapters/task-form";
import type { JournalFillHints } from "@/lib/journal-fill-hints";
import { TIME_OFFSET_CHIPS } from "@/lib/journal-fill-hints";
import { suggestionKey, type NameSuggestionMeta } from "@/lib/name-suggestions";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { QR_PIN_OK_HTML, QR_PIN_UI_CSS, QR_REMEMBER_LABEL, qrCheckHtml } from "@/lib/qr-pin-ui";

/**
 * QR-форма журнала как обычный серверный HTML: без React-загрузчика,
 * без общих стилей кабинета, без шрифтов. Страница весит ~15 КБ и
 * работает без JavaScript (ссылки и `<form method="post">`); маленький
 * инлайн-скрипт лишь добавляет удобства (чипы, температура по блюду,
 * живая проверка нормы). Причина: на медленной сети в цехе React-версия
 * оживала через 10 с.
 *
 * Форма компактная: подпись поля живёт внутри поля (плавающая), пункты
 * «что сделать» — короткий нумерованный список без имени сотрудника,
 * обязательность — звёздочка, отклонение от нормы подсвечивается при
 * вводе.
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
body{margin:0;background:#fafbff;color:#0b1024;font:18px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:#3848c7}
.hero{color:#fff;padding:calc(14px + var(--safe-area-inset-top,env(safe-area-inset-top,0px))) 0 14px;background:radial-gradient(circle at 8% 0%,rgba(85,102,246,.55),transparent 55%),radial-gradient(circle at 100% 100%,rgba(122,92,255,.4),transparent 55%),#0b1024}
.wrap{max-width:36rem;margin:0 auto;padding:0 16px}
.hero .top{display:flex;gap:10px;align-items:center}
.hero .ht{min-width:0;flex:1}
.hero .ico{flex:none;width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center}
.eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
h1{font-size:19px;line-height:1.25;margin:1px 0 0;font-weight:600;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sub{margin:3px 0 0;font-size:14px;color:rgba(255,255,255,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
main{padding:14px 0 20px}
.card{background:#fff;border:1px solid #ececf4;border-radius:20px;padding:16px;box-shadow:0 0 0 1px rgba(240,240,250,.45);margin-bottom:12px}
.label{font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6f7282;margin:0 0 10px}
.list{display:flex;flex-direction:column;gap:8px}
.item{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:72px;padding:12px 16px;border:1px solid #dcdfed;border-radius:14px;background:#fff;color:#0b1024;text-decoration:none;font-weight:600;font-size:22px;line-height:1.25}
button.item{width:100%;font-family:inherit;text-align:left;cursor:pointer;-webkit-appearance:none;appearance:none}
.item.on{border-color:#5566f6;background:#eef1ff}
.item.done{border-color:#d4f5e3;background:#f3fdf7;color:#116b2a}
.item small{display:block;font-weight:400;color:#6f7282;font-size:18px;margin-top:3px}
.item .arr{flex:none;color:#9b9fb3}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:60px;border:0;border-radius:14px;background:#5566f6;color:#fff;font:inherit;font-size:19px;font-weight:600;text-decoration:none;box-shadow:0 10px 30px -12px rgba(85,102,246,.55);cursor:pointer}
.btn:disabled{opacity:.6}
.btn.second{background:#f5f6ff;color:#3848c7;box-shadow:none;border:1px solid rgba(85,102,246,.3);font-weight:500}
.sticky{position:sticky;bottom:0;z-index:5;padding:12px 0 max(var(--safe-area-inset-bottom,env(safe-area-inset-bottom)),10px);background:linear-gradient(to top,#fafbff 72%,rgba(250,251,255,0))}
.who{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px;padding:8px 12px;border:1px solid #ececf4;border-radius:14px;background:#fff}
.who .wl{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.who .k{font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#9b9fb3}
.who .v{font-size:22px;font-weight:600;color:#0b1024;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.who a{flex:none;align-self:center;display:inline-flex;align-items:center;min-height:44px;font-size:16px;font-weight:600;text-decoration:none;color:#3848c7;padding:0 16px;border-radius:999px;background:#eef1ff}
.steps{margin:0 0 12px;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}
.steps li{display:flex;gap:10px;font-size:16.5px;color:#3c4053;line-height:1.35}
.steps .n{flex:none;width:24px;height:24px;border-radius:999px;background:#eef1ff;color:#3848c7;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:1px}
.steps small{display:block;color:#6f7282;margin-top:2px}
.obj{background:#fff;border:1px solid #ececf4;border-radius:16px;padding:12px 12px 6px;margin-bottom:10px;box-shadow:0 0 0 1px rgba(240,240,250,.45)}
.obj-t{font-size:21px;line-height:1.25;margin:0 0 10px 2px;font-weight:700;font-weight:600;margin:0 0 8px 2px;line-height:1.3}
.cols{display:grid;grid-template-columns:1fr;gap:10px}
.cols.one{grid-template-columns:1fr}
.cols .fl{margin-bottom:10px}
.obj .in{background:#fafbff}
.pill{position:absolute;right:10px;top:33px;transform:translateY(-50%);min-width:24px;height:24px;padding:0 6px;border-radius:999px;font-size:13px;font-weight:700;display:none;align-items:center;justify-content:center;pointer-events:none}
.fl.good .pill{display:inline-flex;background:#dcfce7;color:#116b2a}
.fl.bad .pill{display:inline-flex;background:#fff0c2;color:#7a4a00}
.fl.good .in,.fl.bad .in{padding-right:40px}
.box{position:relative}
.stp{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:12px;border:1px solid #dcdfed;background:#fff;color:#3848c7;font:inherit;font-size:22px;font-weight:600;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
.stp:active{background:#eef1ff;border-color:#5566f6}
.stp.minus{left:8px}.stp.plus{right:8px}
.fl.has-step .in{padding-left:60px;padding-right:60px}
.fl.has-step .box>label{left:60px;max-width:calc(100% - 120px)}
.fl.has-step .pill{right:60px}
.fl.has-step.good .in,.fl.has-step.bad .in{padding-right:92px}
.fl>label.lab,.fl.up>label.lab{position:static;top:auto;left:auto;display:block;font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6f7282;margin:0 0 5px 2px;line-height:1.3;max-width:none;white-space:normal;overflow:visible;pointer-events:auto}
.stamp{font-weight:500;letter-spacing:0;text-transform:none;white-space:nowrap}
.lab .lab-t,.lab .lab-s{display:block}
.lab .lab-s{min-height:1.3em;font-weight:500;letter-spacing:0;text-transform:none;color:#9b9fb3}
.lab .lab-s .stamp{color:inherit}
.box.flat .in{padding:12px 44px;min-height:60px;text-align:center;font-weight:600}
.box.flat .stp{width:36px;height:36px;font-size:22px;border-radius:10px}.box.flat .stp.minus{left:6px}.box.flat .stp.plus{right:6px}
.box.flat .pill{right:auto;left:50%;top:auto;bottom:3px;transform:translateX(-50%);min-width:16px;height:14px;font-size:9px;padding:0 4px}
.fl.has-step.good .box.flat .in,.fl.has-step.bad .box.flat .in{padding-right:42px}
.chips.offrow{margin:14px 0 4px}
.chip.offc{color:#6f7282;border-style:dashed;gap:8px;height:38px;padding:0 12px 0 9px;cursor:pointer}
.chip.offc input{width:20px;height:20px;margin:0;accent-color:#5566f6}
.chip.offc.on{background:#f5f6ff;border-style:solid;border-color:#5566f6;color:#3848c7}
.chips.offrow.sts{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0 4px}
.fl.is-off .box .in{background:#f3f4f8;color:#9b9fb3}
.fl.is-off .stp,.fl.is-off .qv{opacity:.35;pointer-events:none}
.fl.is-off .st{color:#3848c7}
.note.draft{display:flex;justify-content:space-between;align-items:center;gap:10px}
.lnk{background:none;border:0;padding:0;color:#3848c7;font:inherit;font-weight:600;text-decoration:underline;cursor:pointer;white-space:nowrap}
.seg{display:flex;flex-wrap:wrap;gap:8px}
.segb{flex:1 1 30%;min-width:96px;display:flex;align-items:center;justify-content:center;min-height:58px;padding:8px 10px;border:1px solid #dcdfed;border-radius:14px;background:#fff;font-size:18px;font-weight:600;color:#0b1024;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent}
.segb input{position:absolute;opacity:0;width:0;height:0}
.segb.on,.segb:has(input:checked){border-color:#5566f6;background:#eef1ff;color:#3848c7;box-shadow:0 0 0 3px rgba(85,102,246,.15)}
.seg-wrap .lab{margin-bottom:8px}
.fl.has-step .in{text-align:center;font-size:24px;font-weight:600}
.sheet{position:fixed;inset:0;z-index:120;background:rgba(11,16,36,.45);display:flex;align-items:flex-end}
.sheet[hidden]{display:none}
.sheet .sh{width:100%;max-height:88dvh;display:flex;flex-direction:column;background:#fafbff;border-radius:22px 22px 0 0;box-shadow:0 -20px 60px -30px rgba(11,16,36,.55)}
.sheet .sh-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 16px 8px;font-size:19px;font-weight:600}
.sheet .sh-x{width:40px;height:40px;border-radius:999px;border:0;background:#fff;box-shadow:0 0 0 1px #ececf4;font-size:22px;color:#6f7282;cursor:pointer}
.sheet .sh-s{padding:0 16px 8px}
.sheet .sh-l{flex:1;overflow-y:auto;padding:0 16px max(var(--safe-area-inset-bottom,env(safe-area-inset-bottom)),16px)}
.who.emp{cursor:pointer}
.fl.big .in{min-height:96px;padding-top:34px;padding-bottom:8px;font-size:44px;line-height:1;font-weight:700;text-align:center}
.fl.big .box>label{top:10px}
.fl.big .stp,.fl.big .pill{top:50%}
.today{margin:-4px 0 12px;font-size:16px;color:#3c4053;line-height:1.35}
.today b{font-weight:600;color:#0b1024}
.prog{display:block;width:max-content;max-width:100%;margin:0 auto 8px;padding:4px 14px;border-radius:999px;background:#fff;border:1px solid #ececf4;font-size:14px;color:#6f7282;text-align:center;font-variant-numeric:tabular-nums}
.prog.done{color:#116b2a;border-color:#d4f5e3;background:#f3fdf7}
.fl{position:relative;margin-bottom:10px}
.fl .in{padding:27px 15px 8px;min-height:66px}
.fl>label,.fl .box>label{position:absolute;left:16px;top:22px;font-size:17px;color:#9b9fb3;pointer-events:none;transition:top .15s,font-size .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 32px);line-height:1.2}
.fl .in:focus~label,.fl .in:not(:placeholder-shown)~label,.fl.up>label,.fl.up .box>label{top:9px;font-size:12.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6f7282}
.fl.bad .in{border-color:#e9b949;background:#fffaeb}
.fl.good .in{border-color:#8fd3a8}
.st{font-size:14.5px;margin:4px 0 0 3px;color:#9b9fb3;line-height:1.3}
.st:empty{display:none}
.fl.bad .st{color:#7a4a00;font-weight:500}
.fl.good .st{color:#116b2a}
.req{color:#e11d48;font-weight:700;margin-left:2px}
.in{display:block;width:100%;min-height:58px;border:1px solid #dcdfed;border-radius:14px;padding:12px 15px;font:inherit;font-size:19px;color:#0b1024;background:#fff;-webkit-appearance:none;appearance:none;margin:0}
textarea.in{min-height:84px;resize:vertical}
.fl textarea.in{min-height:64px}
select.in{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236f7282' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:38px}
input.in[type=time],input.in[type=date]{display:flex;align-items:center;line-height:1.2}
input.in[type=time]{font-weight:600;font-variant-numeric:tabular-nums}
.in:focus{outline:none;border-color:#5566f6;box-shadow:0 0 0 4px rgba(85,102,246,.15)}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin:-4px 0 10px}
.chip{display:inline-flex;align-items:center;height:38px;padding:0 14px;border:1px solid #dcdfed;border-radius:999px;background:#fff;color:#3c4053;font:inherit;font-size:15px;font-weight:500;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.chip.on{border-color:#5566f6;background:#eef1ff;color:#3848c7}
.hint{font-size:14.5px;color:#9b9fb3;margin:6px 0 0}
.err{border:1px solid #ffd2cd;background:#fff4f2;color:#a13a32;border-radius:14px;padding:12px 14px;font-size:16px;margin-bottom:10px}
.warn{border:1px solid #ffe9b0;background:#fff8eb;color:#7a4a00;border-radius:14px;padding:14px;font-size:14px;line-height:1.5}
.muted{color:#6f7282;font-size:16px;line-height:1.5;margin:0}
.check{display:flex;align-items:center;gap:12px;min-height:54px;padding:8px 15px;border:1px solid #dcdfed;border-radius:14px;background:#fff;margin-bottom:10px;font-size:17px;font-weight:500;cursor:pointer}
.check input{width:24px;height:24px;margin:0;accent-color:#5566f6;flex:none}
.dev{border:1px solid #ffe9b0;background:#fff8eb;border-radius:14px;padding:12px 14px;margin-bottom:10px}
.dev b{display:block;color:#7a4a00;font-size:16.5px;margin-bottom:4px}
.dev p{margin:0 0 8px;font-size:15px;color:#7a4a00}
.dev textarea.in{margin:0}
.dev .chips{margin:8px 0 0;gap:6px}
.dev .chip{height:38px;padding:0 14px;font-size:15px}
.note{border:1px solid #d6dcff;background:#eef1ff;color:#3848c7;border-radius:14px;padding:11px 14px;font-size:16px;line-height:1.4;margin-bottom:10px}
.chips.qv{margin:8px 0 0;gap:6px}
.qv .chip{height:38px;padding:0 10px;min-width:48px;justify-content:center;font-size:16px;color:#3848c7;border-color:#d6dcff;background:#fff}
.qv .chip.on{background:#eef1ff;border-color:#5566f6}
.cols .qv .chip{flex:1;min-width:0;padding:0 4px}
.cols>.fl{min-width:0}
.cols .chips.offrow{width:100%}
.cols .st{display:block;min-height:1.3em}
.cols .chip.offc{width:100%;max-width:100%;height:auto;min-height:30px;padding:4px 8px;white-space:normal;line-height:1.2;text-align:left;justify-content:flex-start;box-sizing:border-box}
.chip.offc input{flex:none}
.ok{display:flex;justify-content:center;padding:12px 0;margin:4px auto 14px}
.center{text-align:center}
h2{font-size:21px;letter-spacing:-.02em;margin:0;font-weight:600}
.photo{border:1px dashed #dcdfed;border-radius:14px;padding:10px 14px;margin-bottom:10px;font-size:13px;color:#6f7282}
[hidden]{display:none!important}
.search{margin-bottom:10px}
.tabs{display:flex;gap:6px;padding:4px;margin:0 0 12px;border-radius:16px;background:#eef1ff}
.tabs a{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;min-height:46px;padding:4px 8px;border-radius:12px;font-size:16px;font-weight:600;color:#3848c7;text-decoration:none;line-height:1.2}
.tabs a.on{background:#fff;color:#0b1024;box-shadow:0 1px 3px rgba(11,16,36,.12)}
.bk-h{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin:2px 2px 10px}
.bk-n{font-size:19px;font-weight:600;line-height:1.3;word-break:break-word}
.bk-t{display:block;font-size:14.5px;font-weight:400;color:#6f7282;margin-top:2px}
.bk-s{flex:none;max-width:48%;font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;text-align:right;line-height:1.3}
.bk-s.signed{background:#ecfdf5;color:#116b2a}
.bk-s.wait{background:#fff8eb;color:#9a5b00}
.bk .seg{margin-bottom:10px;gap:6px}
.bk .segb{min-height:48px;padding:6px 6px;font-size:15px;flex:1 1 45%;min-width:0;overflow-wrap:break-word;-webkit-hyphens:auto;hyphens:auto}
.bk .in{min-height:52px;font-size:17px;padding:10px 14px;margin-bottom:10px}
.bk .check{min-height:50px;margin-bottom:8px}
.bk-e{display:grid;grid-template-columns:minmax(0,1fr) 116px;gap:8px}
.bk-del{display:inline-block;font-size:15px;color:#a13a32;margin:0 2px 8px}
.bk-sub{font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6f7282;margin:0 0 6px 2px}
.btn.danger{background:#d2453d;box-shadow:0 10px 30px -12px rgba(210,69,61,.55)}
.btn+.btn{margin-top:8px}
.os-list{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:6px}
.os-i{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;padding:10px 14px;border:1px solid #ececf4;border-radius:14px;background:#fff}
.os-i.done{border-color:#d4f5e3;background:#f3fdf7}
.os-n{min-width:0;font-size:18px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.os-n small{display:block;font-size:14.5px;font-weight:400;color:#6f7282;margin-top:2px}
.os-s{flex:none;width:32px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:#dcfce7;color:#116b2a}
.os-s.todo{background:#f3f4f8;color:#9b9fb3;font-weight:600}
.os-foot{font-size:14.5px}
.os-empty h2{margin-bottom:8px}
.os-empty .muted{margin-bottom:14px}
${QR_PIN_UI_CSS}`;

/** Подпись под полем с отметкой «Обслуживание»/«Ремонт» — одна для сервера и инлайн-скрипта. */
export function statusMarkNote(status: ColdEquipmentStatus): string {
  return `${COLD_EQUIPMENT_STATUS_TITLE[status]} — в журнал «${COLD_EQUIPMENT_STATUS_SHORT[status]}», норма не проверяется`;
}

const STATUS_MARK_NOTES: Record<string, string> = Object.fromEntries(COLD_EQUIPMENT_STATUSES.map((status) => [status, statusMarkNote(status)]));

/** Инлайн-скрипт: только удобства, страница работает и без него. */
export const QR_FILL_JS = `
(function(){
  function hhmm(d){return (d.getHours()<10?"0":"")+d.getHours()+":"+(d.getMinutes()<10?"0":"")+d.getMinutes();}
  function key(s){return String(s||"").replace(/\\s+/g," ").trim().toLowerCase();}
  function fire(el){var ev=document.createEvent("Event"); ev.initEvent("input",true,true); el.dispatchEvent(ev);}
  document.addEventListener("click",function(e){
    var sp=e.target.closest?e.target.closest("[data-step]"):null;
    if(sp){ e.preventDefault(); var si=document.getElementById("f-"+sp.getAttribute("data-step")); if(!si) return; var d=Number(sp.getAttribute("data-delta")||"1");
      if(si.type==="time"){ var tm=/^(\\d{1,2}):(\\d{2})$/.exec(si.value); var nd=new Date(); var base=tm?Number(tm[1])*60+Number(tm[2]):nd.getHours()*60+nd.getMinutes(); var tot=(((base+d)%1440)+1440)%1440; si.value=(Math.floor(tot/60)<10?"0":"")+Math.floor(tot/60)+":"+(tot%60<10?"0":"")+(tot%60); }
      else { var sv=si.value.replace(",",".").trim(); var smn=si.getAttribute("data-min"), smx=si.getAttribute("data-max"); var sn;
        /* Пустое поле первым касанием попадает в середину нормы, дальше ±1. */
        if(sv===""||!isFinite(Number(sv))){ sn=(smn!==null&&smx!==null)?Math.round((Number(smn)+Number(smx))/2):0; } else { sn=Math.round((Number(sv)+d)*10)/10; }
        si.value=String(sn); }
      fire(si); return; }
    var b=e.target.closest?e.target.closest("[data-fill]"):null; if(!b) return;
    e.preventDefault();
    var el=document.getElementById("f-"+b.getAttribute("data-fill")); if(!el) return;
    var ago=b.getAttribute("data-ago");
    if(ago===null&&el.hasAttribute("data-lines")){ var lv=b.getAttribute("data-value")||""; var cur=el.value.replace(/\\s+$/,""); el.value=cur?cur+"\\n"+lv:lv; fire(el); el.focus(); return; }
    el.value=ago!==null?hhmm(new Date(Date.now()-Number(ago)*60000)):(b.getAttribute("data-value")||"");
    var g=b.parentNode.querySelectorAll("[data-fill]");
    for(var i=0;i<g.length;i++) g[i].classList.toggle("on",g[i]===b);
    fire(el);
  });
  var meta=window.__qrTemps||{}; var tempKey=window.__qrTempKey; var nameKey=window.__qrNameKey; var auto=false;
  var nameEl=nameKey?document.getElementById("f-"+nameKey):null; var tempEl=tempKey?document.getElementById("f-"+tempKey):null;
  var hintEl=document.getElementById("temp-hint");
  if(nameEl&&tempEl){
    nameEl.addEventListener("input",function(){
      var t=meta[key(nameEl.value)];
      if(t&&(tempEl.value===""||auto)){tempEl.value=t;auto=true;if(hintEl)hintEl.hidden=false;checkAll();}
      else if(auto&&!t){tempEl.value="";auto=false;if(hintEl)hintEl.hidden=true;checkAll();}
    });
    tempEl.addEventListener("input",function(){auto=false;if(hintEl)hintEl.hidden=true;});
  }
  /* Меню мастер-кабинета: выход и время изготовления по блюду — пустой выход и нетронутое время. */
  var menu=window.__qrMenu||null; var mk=window.__qrMenuKeys||{};
  var mName=mk.name?document.getElementById("f-"+mk.name):null;
  if(menu&&mName){
    var mP=mk.portion?document.getElementById("f-"+mk.portion):null; var mT=mk.time?document.getElementById("f-"+mk.time):null;
    var pAuto=false,tAuto=false,filling=false,tBase=mT?mT.value:""; var tUser=!!document.querySelector("#qr-form .err");
    if(mT) mT.addEventListener("input",function(){ if(!filling){ tUser=true; tAuto=false; } });
    if(mP) mP.addEventListener("input",function(){ if(!filling) pAuto=false; });
    mName.addEventListener("input",function(){
      var m=menu[key(mName.value)]||null; filling=true;
      if(mP){ if(m&&m.p&&(mP.value===""||pAuto)){ mP.value=m.p; pAuto=true; fire(mP); } else if(pAuto&&!(m&&m.p)){ mP.value=""; pAuto=false; fire(mP); } }
      if(mT&&!tUser){ if(m&&m.h){ if(!tAuto) tBase=mT.value; mT.value=m.h; tAuto=true; fire(mT); } else if(tAuto){ mT.value=tBase; tAuto=false; fire(mT); } }
      filling=false;
    });
  }
  /* Живая проверка нормы: подсветка поля и подпись под ним прямо при вводе. */
  function live(t){
    var w=t.closest?t.closest(".fl"):null; if(!w) return null;
    var st=w.querySelector(".st"); var unit=t.getAttribute("data-unit")||"";
    var mn=t.getAttribute("data-min"), mx=t.getAttribute("data-max");
    var norm=(mn!==null&&mx!==null)?mn+"…"+mx:(mn!==null?"не ниже "+mn:(mx!==null?"не выше "+mx:""));
    if(w.classList.contains("is-off")){ w.classList.remove("bad","good"); return null; }
    var v=t.value.replace(",",".").trim();
    var qc=w.querySelectorAll(".qv [data-fill]"); for(var j=0;j<qc.length;j++) qc[j].classList.toggle("on",qc[j].getAttribute("data-value")===v);
    if(v===""||!isFinite(Number(v))){ w.classList.remove("good"); if(!t.hasAttribute("aria-required")) w.classList.remove("bad"); if(st) st.textContent=w.classList.contains("bad")?"Не заполнено":(t.hasAttribute("data-plain")&&norm?"Норма "+norm+(unit?" "+unit:""):""); return null; }
    var n=Number(v); var low=mn!==null&&n<Number(mn); var high=mx!==null&&n>Number(mx);
    w.classList.toggle("bad",low||high); w.classList.toggle("good",!(low||high)&&norm!=="");
    var pill=w.querySelector(".pill"); if(pill) pill.textContent=(low||high)?"!":"✓";
    var flat=!!w.querySelector(".box.flat");
    if(st) st.textContent=(low||high)?((low?"Ниже":"Выше")+" нормы"+(flat?"":" "+norm+(unit?" "+unit:""))):(norm?"В норме":"");
    return (low||high)?(t.getAttribute("data-label")||""):null;
  }
  /* Счётчик обязательных полей у кнопки — видно, сколько осталось. */
  var prog=document.getElementById("prog");
  function progress(){
    if(!prog) return; var req=document.querySelectorAll("#qr-form .in[aria-required]"); var done=0;
    for(var i=0;i<req.length;i++){ if(String(req[i].value||"").trim()!=="") done++; }
    if(!req.length){prog.hidden=true;return;}
    prog.hidden=false; prog.classList.toggle("done",done===req.length);
    /* Плашка «Не заполнено» гаснет, как только всё заполнено или отмечено. */
    var er=document.querySelector(".err[data-missing]"); if(er) er.hidden=done===req.length;
    prog.textContent=done===req.length?"Всё заполнено ✓":"Заполнено "+done+" из "+req.length;
  }
  /* Отметки вместо показания: «Выключено / Нет показания» (галочка) и у холодильников «Обслуживание»/«Ремонт».
     Не больше одной на поле — новая снимает прежнюю; поле гаснет и перестаёт быть обязательным, норма не
     проверяется. Повторное касание выбранной «Обслуживание»/«Ремонт» снимает её. */
  var stNotes=${jsonForScript(STATUS_MARK_NOTES)};
  function marks(t,tap){
    var el=document.getElementById("f-"+t.name.slice(t.name.indexOf(":")+1)); var w=el&&el.closest?el.closest(".fl"):null; if(!el||!w) return;
    if(tap&&t.type==="radio"&&t.getAttribute("data-on")==="1") t.checked=false;
    var all=w.querySelectorAll(".offrow input"); var on=null;
    for(var i=0;i<all.length;i++){ var x=all[i]; if(t.checked&&x!==t) x.checked=false; if(x.checked) on=x; x.setAttribute("data-on",x.checked?"1":"0"); var lb=x.closest?x.closest(".offc"):null; if(lb) lb.classList.toggle("on",x.checked); }
    var was=w.classList.contains("is-off"); w.classList.toggle("is-off",!!on); var st=w.querySelector(".st"); var pill=w.querySelector(".pill");
    if(on){ if(!el.hasAttribute("data-req")) el.setAttribute("data-req",el.hasAttribute("aria-required")?"1":"0"); el.removeAttribute("aria-required"); el.value=""; w.classList.remove("bad","good"); if(pill) pill.textContent="";
      if(st) st.textContent=on.type==="radio"?(stNotes[on.value]||""):(w.querySelector(".box.flat")?"Уведомим руководителя":(on.parentNode&&on.parentNode.textContent.trim()==="${OFF_NOTE_EQUIPMENT}"?"Выключено — руководитель получит уведомление":"Нет показания — руководитель получит уведомление")); }
    else if(was){ if(el.getAttribute("data-req")==="1") el.setAttribute("aria-required","true"); if(st) st.textContent=""; fire(el); }
    progress(); if(typeof checkAll==="function") checkAll();
  }
  function isMark(t){ return !!(t&&t.name&&(t.name.indexOf("off:")===0||t.name.indexOf("status:")===0)); }
  var rd=document.querySelectorAll('.offrow input[type=radio]'); for(var ri=0;ri<rd.length;ri++) rd[ri].setAttribute("data-on",rd[ri].checked?"1":"0");
  document.addEventListener("change",function(e){ if(isMark(e.target)) marks(e.target,false); });
  document.addEventListener("click",function(e){ var t=e.target; if(isMark(t)&&t.type==="radio") marks(t,true); });
  document.addEventListener("change",function(e){ var t=e.target; if(!t||t.type!=="radio") return; var wrap=t.closest?t.closest(".seg"):null; if(!wrap) return; var ls=wrap.querySelectorAll(".segb"); for(var i=0;i<ls.length;i++){ var inp=ls[i].querySelector("input"); ls[i].classList.toggle("on",!!(inp&&inp.checked)); } });
  /* Смена сотрудника — шторка с поиском на той же странице (без скриптов — ссылка на шаг выбора). */
  var sheet=document.getElementById("emp-sheet");
  if(sheet){
    function openSheet(){ sheet.hidden=false; document.body.style.overflow="hidden"; var si=document.getElementById("emp-sheet-search"); if(si){ setTimeout(function(){ si.focus({preventScroll:true}); },60); } }
    function closeSheet(){ sheet.hidden=true; document.body.style.overflow=""; }
    var opener=document.querySelector("[data-emp-open]"); if(opener) opener.addEventListener("click",function(e){ e.preventDefault(); openSheet(); });
    sheet.addEventListener("click",function(e){ if(e.target===sheet) closeSheet(); });
    var xb=sheet.querySelector(".sh-x"); if(xb) xb.addEventListener("click",closeSheet);
    document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeSheet(); });
    var ss=document.getElementById("emp-sheet-search"); if(ss){ ss.addEventListener("input",function(){ var s=key(ss.value); var it=sheet.querySelectorAll("[data-emp]"); for(var i=0;i<it.length;i++){ it[i].hidden=s!==""&&key(it[i].getAttribute("data-emp")).indexOf(s)<0; } }); }
  }
  document.addEventListener("input",progress); document.addEventListener("change",progress); progress();
  /* Время в подписях «показания за сегодня» идёт по часам телефона, страница может быть открыта долго. */
  function tick(){ var t=hhmm(new Date()); var st=document.querySelectorAll(".stamp[data-stamp-date]"); for(var i=0;i<st.length;i++) st[i].textContent=st[i].getAttribute("data-stamp-date")+" "+t; var tt=document.querySelectorAll(".stamp-t"); for(var k=0;k<tt.length;k++) tt[k].textContent=t; }
  setInterval(tick,30000);
  var dev=document.getElementById("deviation");
  function checkAll(){
    var out=[]; var ins=document.querySelectorAll("input[data-min],input[data-max]");
    for(var i=0;i<ins.length;i++){ var r=live(ins[i]); if(r) out.push(r); }
    if(dev){ dev.hidden=out.length===0; var t=document.getElementById("deviation-title"); if(t&&out.length) t.textContent=out.join(", ")+" — вне нормы"; }
  }
  document.addEventListener("input",function(e){ var t=e.target; if(t&&t.hasAttribute&&(t.hasAttribute("data-min")||t.hasAttribute("data-max"))) checkAll(); });
  checkAll();
  var form=document.getElementById("qr-form");
  if(form) form.addEventListener("submit",function(){ var b=form.querySelector("button[type=submit]"); if(b){b.disabled=true;b.textContent="Сохраняем…";} });
  var q=document.getElementById("emp-search");
  if(q){ q.addEventListener("input",function(){ var s=key(q.value); var it=document.querySelectorAll("[data-emp]"); for(var i=0;i<it.length;i++){ it[i].hidden=s!==""&&key(it[i].getAttribute("data-emp")).indexOf(s)===-1; } }); }
  /* Черновик: введённое переживает обновление страницы и обрыв связи; после записи стирается, старше 12 часов — не подхватывается. */
  var dk=window.__qrDraftKey||null;
  function draftFields(){ var f=document.getElementById("qr-form"); if(!f) return []; var out=[]; var els=f.querySelectorAll("input,select,textarea"); for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.name||el.type==="hidden"||el.type==="submit"||el.type==="button"||el.type==="password") continue; out.push(el); } return out; }
  function draftRead(){ if(!dk) return null; try{ var raw=localStorage.getItem(dk); if(!raw) return null; var d=JSON.parse(raw); if(!d||!d.t||Date.now()-d.t>43200000){ localStorage.removeItem(dk); return null; } return d; }catch(e){ return null; } }
  /* Радио («Обслуживание»/«Ремонт») — одно значение на имя: выбранное или пусто. */
  function draftSave(){ if(!dk) return; try{ var v={}; var any=false; var els=draftFields(); for(var i=0;i<els.length;i++){ var el=els[i];
      if(el.type==="radio"){ if(el.checked){ v[el.name]=el.value; any=true; } else if(!Object.prototype.hasOwnProperty.call(v,el.name)) v[el.name]=""; continue; }
      var val=el.type==="checkbox"?(el.checked?"1":""):el.value; v[el.name]=val; if(val!==""&&val!=="-") any=true; } if(any) localStorage.setItem(dk,JSON.stringify({t:Date.now(),v:v})); else localStorage.removeItem(dk); }catch(e){} }
  function draftRestore(){ var d=draftRead(); if(!d||!d.v) return; var els=draftFields(); var n=0;
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!Object.prototype.hasOwnProperty.call(d.v,el.name)) continue; var val=d.v[el.name];
      if(el.type==="checkbox"||el.type==="radio"){ var c=el.type==="radio"?el.value===val:val==="1"; if(el.checked!==c){ el.checked=c; n++; var ce=document.createEvent("Event"); ce.initEvent("change",true,true); el.dispatchEvent(ce); } }
      else if(el.value!==val&&val!==""){ el.value=val; n++; fire(el); } }
    if(n>0){ var f=document.getElementById("qr-form"); var note=document.createElement("div"); note.className="note draft"; note.setAttribute("id","draft-note");
      note.innerHTML='<span>Восстановили введённое после обновления страницы.</span><button type="button" class="lnk" id="draft-reset">Начать заново</button>';
      var first=f.querySelector(".err, .note, .fl, .obj"); f.insertBefore(note, first||f.firstChild);
      document.getElementById("draft-reset").addEventListener("click",function(){ try{ localStorage.removeItem(dk); }catch(e){} location.reload(); }); } }
  if(dk&&window.__qrDraftDone){ try{ localStorage.removeItem(dk); }catch(e){} }
  else if(dk&&document.getElementById("qr-form")){ draftRestore(); var dtm=null; function draftLater(){ clearTimeout(dtm); dtm=setTimeout(draftSave,150); } document.addEventListener("input",draftLater); document.addEventListener("change",draftLater); }
})();
`;

const QR_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>`;
const ARROW = `<span class="arr" aria-hidden="true">›</span>`;
const CHECK_SMALL = `<svg class="arr" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3848c7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>`;

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
<header class="hero"><div class="wrap"><div class="top"><div class="ico">${QR_ICON}</div><div class="ht">
<div class="eyebrow" title="${esc(params.orgName)}">${esc(params.orgName)}</div>
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

/**
 * Дополнительный QR документа после конца периода (2026-09-23). Ни одной
 * ссылки в журнал: ссылка несла бы тот же просроченный токен.
 */
export function renderTokenExpired(params: { validUntil: string }): string {
  const [year, month, day] = params.validUntil.split("-");
  return `<div class="card center"><h2>Срок этого QR-кода закончился</h2>
<p class="muted" style="margin-top:8px">Код был на один документ и действовал по ${esc(`${day}.${month}.${year}`)}. Отсканируйте основной QR-код журнала — он работает всегда — или попросите руководителя распечатать новый.</p></div>`;
}

export function renderHub(items: Array<{ code: string; name: string; href: string; note?: string }>): string {
  if (items.length === 0) return renderMessage("warn", "Сегодня нет ни одного активного документа. Попросите руководителя открыть журналы на этот период.");
  return `<div class="card"><p class="label">Что заполнить</p><div class="list">${items
    .map((item) => `<a class="item" href="${esc(item.href)}"><span>${esc(item.name)}${item.note ? `<small>${esc(item.note)}</small>` : ""}</span>${ARROW}</a>`)
    .join("")}</div></div>`;
}

export function renderDocumentStep(params: {
  documents: Array<{ id: string; title: string; building: string | null; href: string }>;
}): string {
  return `<div class="card"><p class="label">Какой документ</p><div class="list">${params.documents
    .map((doc) => `<a class="item" href="${esc(doc.href)}"><span>${esc(doc.title)}${doc.building ? `<small>${esc(doc.building)}</small>` : ""}</span>${ARROW}</a>`)
    .join("")}</div></div>`;
}

/**
 * Форма выбора сотрудника — обычный GET: каждое имя — кнопка `employee`,
 * рядом чекбокс «Запомнить выбор на этом оборудовании» (отмечен по
 * умолчанию). Без скриптов работает так же: браузер сам соберёт адрес.
 */
export type EmployeePickForm = {
  /** Путь без query: `/journal-fill/<org>/<code>`. */
  action: string;
  /** Что нести дальше: token, doc, commission, view… */
  hidden: Record<string, string>;
  /** Показывать ли «Запомнить» (в режиме входа по кабинету — нет). */
  showRemember: boolean;
  /** Отмечен ли чекбокс (по умолчанию — да). */
  rememberOn?: boolean;
};

function renderPickItems(
  employees: Array<{ id: string; name: string; positionTitle: string | null }>,
  currentId: string | null
): string {
  return employees
    .map(
      (item) =>
        `<button class="item${item.id === currentId ? " on" : ""}" type="submit" name="employee" value="${esc(item.id)}" data-emp="${esc(item.name)}"><span>${esc(item.name)}${item.positionTitle ? `<small>${esc(item.positionTitle)}</small>` : ""}</span>${item.id === currentId ? CHECK_SMALL : ARROW}</button>`
    )
    .join("");
}

function renderPickHidden(pick: EmployeePickForm): string {
  return `${Object.entries(pick.hidden)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("")}<input type="hidden" name="rf" value="1">`;
}

function renderRememberCheck(pick: EmployeePickForm): string {
  if (!pick.showRemember) return "";
  return `<label class="qp-remember"><input type="checkbox" name="remember" value="1"${pick.rememberOn === false ? "" : " checked"}>${esc(QR_REMEMBER_LABEL)}</label>`;
}

export function renderEmployeeStep(params: {
  pick: EmployeePickForm;
  employees: Array<{ id: string; name: string; positionTitle: string | null }>;
  /** Кто выбран сейчас («Сменить») — отмечен в списке. */
  currentId?: string | null;
  hintText?: string | null;
}): string {
  const search = params.employees.length > 6 ? `<div class="search"><input id="emp-search" class="in" type="search" placeholder="Найти по фамилии" autocomplete="off" aria-label="Поиск сотрудника"></div>` : "";
  return `<form method="get" action="${esc(params.pick.action)}" class="card">${renderPickHidden(params.pick)}<p class="label">Кто заполняет</p>${search}<div class="list">${renderPickItems(
    params.employees,
    params.currentId ?? null
  )}</div>${renderRememberCheck(params.pick)}${params.hintText ? `<p class="hint">${esc(params.hintText)}</p>` : ""}</form>`;
}

/**
 * Шаг «Ваш PIN» — ДО формы, во всю ширину (без белой карточки): крупное
 * поле, крупная подсказка, справа от заголовка — «Запросить смену PIN».
 */
export function renderPinStep(params: {
  action: string;
  who: string;
  error?: string | null;
  changePinHref?: string | null;
}): string {
  return `${params.who}
<form method="post" action="${esc(params.action)}" id="qr-pin">
<input type="hidden" name="action" value="pin">
<div class="qp-head"><label class="qp-k" for="qp-pin">Ваш PIN</label>${params.changePinHref ? `<a class="qp-link" href="${esc(params.changePinHref)}">Запросить смену PIN</a>` : ""}</div>
${params.error ? `<div class="qp-err" role="alert">${esc(params.error)}</div>` : ""}
<input id="qp-pin" class="qp-pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="••••" required autofocus>
<p class="qp-hint">PIN для подтверждения личности</p>
<div class="sticky"><button class="btn" type="submit">Войти</button></div>
</form>`;
}

/** Зелёная галочка сразу после верного PIN: сама схлопывается, поля всплывают снизу. */
export function renderPinOk(): string {
  return QR_PIN_OK_HTML;
}

function pinPairInputs(firstLabel: string): string {
  return `<div class="qp-head"><label class="qp-k" for="qp-pin">${esc(firstLabel)}</label></div>
<input id="qp-pin" class="qp-pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" placeholder="••••" required>
<div class="qp-head" style="margin-top:16px"><label class="qp-k" for="qp-pin2" style="font-size:20px">Повторите PIN</label></div>
<input id="qp-pin2" class="qp-pin" type="password" name="pin2" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" placeholder="••••" required style="min-height:96px">`;
}

/**
 * PIN нужен, а у сотрудника его нет: коротко и крупно, сразу поле «Придумайте
 * PIN» и большая «Запросить доступ» — руководитель одобрит, PIN заработает.
 */
export function renderPinNoAccess(params: {
  who: string;
  action: string;
  /** Статус последнего запроса («ждёт», «отклонил…»). */
  status?: { text: string; tone: "wait" | "bad" } | null;
  error?: string | null;
}): string {
  return `${params.who}
<div class="qp-note">Нужен личный PIN для подтверждения личности.</div>
${params.status ? `<div class="${params.status.tone === "bad" ? "qp-err" : "qp-ok-note"}" role="status">${esc(params.status.text)}</div>` : ""}
<form method="post" action="${esc(params.action)}" id="qr-pin">
<input type="hidden" name="action" value="pin-request">
<input type="hidden" name="kind" value="issue">
${params.error ? `<div class="qp-err" role="alert">${esc(params.error)}</div>` : ""}
${pinPairInputs("Придумайте PIN")}
<p class="qp-hint">4–6 цифр. Заработает после одобрения руководителя.</p>
<div class="sticky"><button class="btn" type="submit">Запросить доступ</button></div>
</form>`;
}

/** «Запросить смену PIN»: новый PIN дважды; до одобрения действует старый. */
export function renderPinRequestForm(params: {
  who: string;
  action: string;
  backHref: string;
  error?: string | null;
}): string {
  return `${params.who}
<form method="post" action="${esc(params.action)}" id="qr-pin">
<input type="hidden" name="action" value="pin-request">
<input type="hidden" name="kind" value="change">
<p class="qp-hint" style="margin:4px 2px 14px;color:#3c4053">Новый PIN заработает после одобрения, до этого действует старый.</p>
${params.error ? `<div class="qp-err" role="alert">${esc(params.error)}</div>` : ""}
${pinPairInputs("Новый PIN")}
<div class="sticky"><button class="btn" type="submit">Запросить смену PIN</button><a class="btn second" href="${esc(params.backHref)}">Отмена</a></div>
</form>`;
}

/** Запрос отправлен: что будет дальше. */
export function renderPinRequestSent(params: { who: string; kind: "issue" | "change"; backHref: string }): string {
  return `${params.who}
<div class="center">${QR_PIN_OK_HTML.replace('class="qp-ok"', 'class="qp-ok" style="animation:none"')}</div>
<h2 class="center" style="margin:6px 0 10px">Запрос отправлен</h2>
<p class="qp-hint center" style="color:#3c4053">${
    params.kind === "change"
      ? "Новый PIN заработает после одобрения, пока действует старый."
      : "PIN заработает после одобрения. Затем отсканируйте QR снова."
  }</p>
<div class="sticky"><a class="btn second" href="${esc(params.backHref)}">${params.kind === "change" ? "Вернуться к вводу PIN" : "Готово"}</a></div>`;
}

export function renderRowStep(params: { rows: Array<{ rowKey: string; label: string; sublabel?: string; mine: boolean; href: string }>; who: string }): string {
  if (params.rows.length === 0) return renderMessage("muted", "В этом документе пока нет строк, которые можно заполнить от вашего имени. Попросите руководителя назначить вас в журнале.");
  return `${params.who}<div class="card"><p class="label">Что именно</p><div class="list">${params.rows
    .map((row) => `<a class="item${row.mine ? " on" : ""}" href="${esc(row.href)}"><span>${esc(row.label)}${row.sublabel ? `<small>${esc(row.sublabel)}</small>` : ""}</span>${ARROW}</a>`)
    .join("")}</div></div>`;
}

/** «Вы / документ» — компактный блок: подпись мелким капсом, значение до двух строк, справа «Сменить». */
export function renderWho(params: {
  employeeName: string;
  changeHref: string | null;
  documentTitle?: string | null;
  documentChangeHref?: string | null;
  /** Список для шторки «Сменить» на той же странице (со скриптами); без них — ссылка на шаг выбора. */
  employees?: Array<{ id: string; name: string; positionTitle: string | null; current: boolean }>;
  /** Форма выбора для шторки (как на шаге сотрудника, с «Запомнить»). */
  pick?: EmployeePickForm | null;
}): string {
  const row = (k: string, v: string, href: string | null, extra = "") =>
    `<div class="who${extra ? " emp" : ""}"><div class="wl"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>${href ? `<a href="${esc(href)}"${extra}>Сменить</a>` : ""}</div>`;
  const current = params.employees?.find((item) => item.current)?.id ?? null;
  const sheet =
    params.changeHref && params.pick && params.employees && params.employees.length > 0
      ? `<div class="sheet" id="emp-sheet" hidden role="dialog" aria-modal="true" aria-label="Кто заполняет"><div class="sh"><div class="sh-h"><span>Кто заполняет</span><button type="button" class="sh-x" aria-label="Закрыть">×</button></div><div class="sh-s"><input id="emp-sheet-search" class="in" type="search" placeholder="Найти по фамилии" autocomplete="off" aria-label="Поиск сотрудника"></div><form method="get" action="${esc(params.pick.action)}" class="sh-l">${renderPickHidden(params.pick)}<div class="list">${renderPickItems(
          params.employees,
          current
        )}</div>${renderRememberCheck(params.pick)}</form></div></div>`
      : "";
  return row("Кто заполняет", params.employeeName, params.changeHref, sheet ? " data-emp-open" : "") + (params.documentTitle ? row("Документ", params.documentTitle, params.documentChangeHref ?? null) : "") + sheet;
}

type Suggestions = Record<string, { values: string[]; meta: Record<string, NameSuggestionMeta> }>;

/**
 * Норма для подсветки отклонения: сначала из подписи адаптера
 * («… · норма 2…6»), иначе физические пределы поля (min/max валидатора).
 * У холодильников пределы -40…30, а норма своя у каждого — иначе 12 °C
 * в холодильнике не считалось бы отклонением.
 */
export function normRange(field: TaskFormField): { min: number | null; max: number | null } {
  if (field.type !== "number") return { min: null, max: null };
  // «норма -18…-20» пишут и в обратном порядке — парсер приводит границы к порядку.
  const fromLabel = normFromLabel(field.label);
  if (fromLabel) return fromLabel;
  return { min: field.min ?? null, max: field.max ?? null };
}

/** Подпись поля без хвоста «· норма …» и без «— t°/влажность» климата. */
export function cleanLabel(label: string): string {
  return label
    .replace(/\s*[·(]\s*норма[^)]*\)?\s*$/i, "")
    .replace(/\s*[—–-]\s*(t°|влажность|\d+-й замер)\s*$/i, "")
    .trim();
}

/** «Кухня — t° · норма 18…22» → метрика t°/влажность (климат) и база «Кухня». */
export function metricOf(label: string): { metric: "t°" | "влажность" | "замер" | null; base: string; slot?: string } {
  const slot = /[—–-]\s*(\d+-й замер)/i.exec(label)?.[1];
  const metric = slot ? "замер" : /[—–-]\s*t°/i.test(label) ? "t°" : /[—–-]\s*влажность/i.test(label) ? "влажность" : null;
  return { metric, base: cleanLabel(label), ...(slot ? { slot } : {}) };
}

function metricName(field: Extract<TaskFormField, { type: "number" }>): string {
  const { metric, slot } = metricOf(field.label);
  if (metric === "замер" && slot) return slot;
  if (metric === "t°" || field.unit === "°C") return "Температура";
  if (metric === "влажность" || field.unit === "%") return "Влажность";
  return "Показание";
}

/** Числовое поле «объекта» (склад, холодильник): норма в подписи или метрика климата. */
export function isObjectField(field: TaskFormField): boolean {
  return field.type === "number" && (/норма/i.test(field.label) || metricOf(field.label).metric !== null);
}

/** Имена отметок в HTML-форме: `off:<ключ>` — «Выключено / Нет показания», `status:<ключ>` — «Обслуживание»/«Ремонт». */
export const OFF_MARK_PREFIX = "off:";
export const STATUS_MARK_PREFIX = "status:";

/**
 * Отметки вместо показания из POST формы (работают и без скриптов):
 * «Выключено / Нет показания» — у числовых полей, «Обслуживание»/«Ремонт» —
 * только у полей из `form.statusFields` (холодильники). Прислали обе у
 * одного поля (без скриптов их можно отметить вместе) — остаётся
 * «Обслуживание»/«Ремонт»: отметки не смешиваются.
 */
export function readPostedMarks(
  posted: Pick<FormData, "keys" | "get">,
  form: TaskFormSchema
): { off: string[]; statuses: Record<string, ColdEquipmentStatus> } {
  const statuses: Record<string, unknown> = {};
  for (const key of form.statusFields ?? []) statuses[key] = posted.get(`${STATUS_MARK_PREFIX}${key}`);
  const off = Array.from(new Set(Array.from(posted.keys())))
    .filter((name) => name.startsWith(OFF_MARK_PREFIX))
    .map((name) => name.slice(OFF_MARK_PREFIX.length));
  const resolved = resolveFillMarks(form, off, statuses);
  return { off: Array.from(resolved.offKeys), statuses: resolved.statuses };
}

/**
 * Отметки вместо показания → что уходит в адаптер (`submitJournalFill`).
 * «Обслуживание»/«Ремонт» — только у числовых полей из `statusFields` формы
 * (холодильники), «Выключено / Нет показания» — у числовых полей без такой
 * отметки: обе у одного поля не смешиваются. Отмеченные поля необязательны,
 * их значения не проверяются и не пишутся.
 */
export function resolveFillMarks(
  schema: Pick<TaskFormSchema, "fields" | "statusFields"> | null,
  off: readonly string[] | undefined,
  statuses: Record<string, unknown> | undefined
): { offKeys: Set<string>; statuses: Record<string, ColdEquipmentStatus> } {
  const numberKeys = new Set((schema?.fields ?? []).filter((field) => field.type === "number").map((field) => field.key));
  const statusFields = new Set(schema?.statusFields ?? []);
  const resolved: Record<string, ColdEquipmentStatus> = {};
  for (const [key, raw] of Object.entries(statuses ?? {})) {
    const status = parseColdEquipmentStatus(raw);
    if (status && numberKeys.has(key) && statusFields.has(key)) resolved[key] = status;
  }
  const offKeys = new Set((off ?? []).filter((key) => numberKeys.has(key) && !resolved[key]));
  return { offKeys, statuses: resolved };
}

type NumberField = Extract<TaskFormField, { type: "number" }>;

function lower(text: string): string {
  if (!text) return text;
  const second = text.charAt(1);
  return second && second === second.toUpperCase() && second !== second.toLowerCase() ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Винительный падеж для «Укажите/Выберите/Впишите …»: склоняем только
 * ведущие прилагательные (-ая/-яя → -ую/-юю) и первое существительное
 * (-а/-я → -у/-ю), дальше фразу не трогаем («температура внутри продукта»
 * → «температуру внутри продукта», «время производства» без изменений).
 */
export function accusative(phrase: string): string {
  const words = phrase.split(" ");
  const out: string[] = [];
  let nounDone = false;
  for (const word of words) {
    if (nounDone) {
      out.push(word);
      continue;
    }
    if (/ая$/i.test(word)) out.push(word.replace(/ая$/i, "ую"));
    else if (/яя$/i.test(word)) out.push(word.replace(/яя$/i, "юю"));
    else {
      nounDone = true;
      // «время», «имя» — средний род на -мя, не склоняем как женский.
      if (word.length > 2 && /а$/i.test(word)) out.push(word.replace(/а$/i, "у"));
      else if (word.length > 2 && /я$/i.test(word) && !/мя$/i.test(word)) out.push(word.replace(/я$/i, "ю"));
      else out.push(word);
    }
  }
  return out.join(" ");
}

function joinNames(names: string[], limit = 72): string {
  let out = "";
  for (let i = 0; i < names.length; i += 1) {
    const next = out ? `${out}, ${names[i]}` : names[i];
    if (next.length > limit && i > 0) return `${out} и ещё ${names.length - i}`;
    out = next;
  }
  return out;
}

/**
 * Пункты «что сделать» по полям формы — коротко, без имени сотрудника.
 * Числовые поля с одной единицей объединяются: «Укажите температуру:
 * Холодильник №1, Морозильник». Необязательные текстовые поля пропускаем.
 */
export function formSteps(form: TaskFormSchema, hints: JournalFillHints): string[] {
  const steps: string[] = [];
  const objectFields = form.fields.filter((field): field is NumberField => field.type === "number" && isObjectField(field));
  const objectCount = new Set(objectFields.map((field) => metricOf(field.label).base)).size;
  if (objectFields.length > 0) {
    const metrics = Array.from(new Set(objectFields.map((field) => (metricName(field) === "Влажность" ? "влажность" : "температуру"))));
    steps.push(`Впишите ${metrics.join(" и ")} в карточки ниже (${objectCount})`);
  }
  const numbers = form.fields.filter((field): field is Extract<TaskFormField, { type: "number" }> => field.type === "number" && !isObjectField(field));
  const numberGroups = new Map<string, Extract<TaskFormField, { type: "number" }>[]>();
  for (const field of numbers) {
    const unit = field.unit ?? "";
    numberGroups.set(unit, [...(numberGroups.get(unit) ?? []), field]);
  }
  const seen = new Set<string>();
  for (const field of form.fields) {
    if (field.type === "number") {
      if (isObjectField(field)) continue; // уже в пункте про карточки
      const unit = field.unit ?? "";
      if (seen.has(`unit:${unit}`)) continue;
      seen.add(`unit:${unit}`);
      const group = numberGroups.get(unit) ?? [];
      const noun = unit === "°C" ? "температуру" : unit === "%" ? "влажность" : null;
      if (group.length === 1) {
        const label = cleanLabel(group[0].label);
        steps.push(/температур|влажност|показани/i.test(label) ? `Укажите ${accusative(lower(label))}` : noun ? `Укажите ${noun}: ${lower(label)}` : `Укажите ${accusative(lower(label))}`);
      } else {
        steps.push(`Укажите ${noun ?? "показания"}: ${joinNames(group.map((item) => cleanLabel(item.label)))}`);
      }
      continue;
    }
    if (field.type === "time") steps.push(/врем/i.test(field.label) ? `Укажите ${accusative(lower(field.label))}` : `Укажите время: ${lower(field.label)}`);
    else if (field.type === "date") steps.push(`Укажите ${accusative(lower(field.label))}`);
    else if (field.type === "select") steps.push(/\?\s*$/.test(field.label) ? `Ответьте «${field.label}»` : `Выберите ${accusative(lower(field.label))}`);
    else if (field.type === "boolean") steps.push(`Отметьте, если ${lower(field.label)}`);
    else if (field.type === "text") {
      const isName = Boolean(hints.nameFields?.[field.key]);
      const hasChoices = (hints.choices?.[field.key]?.length ?? 0) > 0;
      if (hasChoices) steps.push(`Выберите ${accusative(lower(cleanLabel(field.label)))}`);
      else if (isName || field.required) steps.push(`Впишите ${accusative(lower(cleanLabel(field.label)))}`);
    }
  }
  steps.push(`Нажмите «${form.submitLabel ?? "Сохранить"}»`);
  return steps;
}

/**
 * Вступление адаптера без имени сотрудника: первое предложение повторяет
 * пункты, остальные (например «Если оборудование выключено — оставьте
 * поле пустым») показываем подсказкой.
 */
export function introHint(intro: string | undefined, employeeName: string): string | null {
  let text = (intro ?? "").trim();
  if (!text) return null;
  const name = employeeName.trim();
  if (name && text.toLowerCase().startsWith(name.toLowerCase())) text = text.slice(name.length).replace(/^[\s,]+/, "");
  if (text.includes("\n")) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const rest = sentences.slice(1).join(" ").trim();
  return rest || null;
}

export function renderForm(params: {
  action: string;
  token: string;
  form: TaskFormSchema;
  hints: JournalFillHints;
  values: Record<string, unknown>;
  suggestions: Suggestions;
  who: string;
  employeeName?: string;
  error?: string | null;
  badKeys?: string[];
  correction?: string;
  showDeviation?: boolean;
  deviationTitle?: string | null;
  correctionPresets: readonly string[];
  openedAt: number;
  /** «20.09.2026» + «18:31» по часовому поясу организации: строка «показания за сегодня» и подписи полей. */
  stamp?: { date: string; time: string } | null;
  /** Поля, отмеченные «Выключено / Нет показания» (при повторном показе формы). */
  offKeys?: string[];
  /** Поля с выбранным «Обслуживание»/«Ремонт» (уже записано сегодня или повторный показ формы). */
  statusMarks?: Record<string, ColdEquipmentStatus>;
  /**
   * PIN только что подтверждён на своём шаге: галочка над формой, поля
   * всплывают снизу. Сам PIN в форме больше не спрашивается — он ДО формы.
   */
  pinOk?: boolean;
}): string {
  const bad = new Set(params.badKeys ?? []);
  const marks: ObjectMarks = {
    off: new Set(params.offKeys ?? []),
    statusKeys: new Set(params.form.statusFields ?? []),
    statuses: params.statusMarks ?? {},
  };
  // Поля объектов (склад/холодильник) — карточкой: «Склад Бакалея» и в ней температура + влажность рядом.
  const parts: string[] = [];
  const fieldsList = params.form.fields;
  for (let i = 0; i < fieldsList.length; i += 1) {
    const field = fieldsList[i];
    if (field.type === "number" && isObjectField(field)) {
      const base = metricOf(field.label).base;
      const group: NumberField[] = [field];
      while (i + 1 < fieldsList.length) {
        const next = fieldsList[i + 1];
        if (next.type === "number" && isObjectField(next) && metricOf(next.label).base === base) {
          group.push(next);
          i += 1;
        } else break;
      }
      parts.push(renderObjectCard(base, group, params.values, bad, params.stamp ?? null, marks));
      continue;
    }
    parts.push(renderField(field, params.values[field.key], params.hints, params.suggestions, bad.has(field.key), params.stamp ?? null));
  }
  const fields = parts.join("");
  const pipeline = params.form.pipeline && params.form.pipeline.length > 0
    ? `<ol class="steps">${params.form.pipeline
        .map((step, index) => `<li><span class="n">${index + 1}</span><span>${esc(step.title)}${step.detail ? `<small>${esc(step.detail)}</small>` : ""}</span></li>`)
        .join("")}</ol>`
    : `<ol class="steps">${formSteps(params.form, params.hints)
        .map((step, index) => `<li><span class="n">${index + 1}</span><span>${esc(step)}</span></li>`)
        .join("")}</ol>`;
  const hint = introHint(params.form.intro, params.employeeName ?? "");
  const hasNumbers = params.form.fields.some((field) => field.type === "number" && (normRange(field).min != null || normRange(field).max != null));
  // По умолчанию выбран первый вариант («Повторю через 30 минут.»): сервер
  // берёт комментарий, только когда значение вне нормы, так что скрытый блок
  // с готовым ответом ничего лишнего в журнал не пишет.
  const correctionValue = params.correction ?? params.correctionPresets[0] ?? "";
  const deviation = hasNumbers
    ? `<div class="dev" id="deviation"${params.showDeviation ? "" : " hidden"}><b id="deviation-title">${esc(params.deviationTitle ?? "Значение вне нормы")}</b><p>Напишите, что вы сделали — это попадёт в журнал рядом с записью.</p><textarea class="in" name="__correction" id="f-__correction" rows="2" placeholder="Что сделали">${esc(correctionValue)}</textarea><div class="chips">${params.correctionPresets
        .map((preset) => `<button type="button" class="chip${preset === correctionValue ? " on" : ""}" data-fill="__correction" data-value="${esc(preset)}">${esc(preset)}</button>`)
        .join("")}</div></div>`
    : "";
  const today = params.stamp
    ? `<p class="today">Показания вносятся за сегодня, <b>${esc(params.stamp.date)}</b>, время <b class="stamp-t">${esc(params.stamp.time)}</b>.</p>`
    : "";
  void hint; // Пояснения из intro и плашку «уже записано» не показываем: значения и так подставлены, лишний текст мешает.
  const body = `${today}${pipeline}
<form method="post" action="${esc(params.action)}" id="qr-form" novalidate>
<input type="hidden" name="action" value="submit">
<input type="hidden" name="__openedAt" value="${params.openedAt}">
${params.error ? `<div class="err"${params.error.startsWith("Не заполнено") ? ` data-missing="1"` : ""}>${esc(params.error)}</div>` : ""}
${fields}
${deviation}
<div class="sticky"><p class="prog" id="prog" hidden></p><button class="btn" type="submit">${esc(params.form.submitLabel ?? "Сохранить")}</button></div>
</form>`;
  return params.pinOk ? `${params.who}${renderPinOk()}<div class="qp-rise">${body}</div>` : `${params.who}${body}`;
}

/** Отметки вместо показания в карточках объектов: что выбрано и где можно «Обслуживание»/«Ремонт». */
type ObjectMarks = {
  /** «Выключено / Нет показания». */
  off: Set<string>;
  /** Поля холодильников — у них рядом с «Выключено» ещё «Обслуживание» и «Ремонт». */
  statusKeys: Set<string>;
  statuses: Record<string, ColdEquipmentStatus>;
};

/** Карточка объекта: название и его числовые поля в две колонки, норма в подписи поля, статус пилюлей. */
function renderObjectCard(
  base: string,
  group: Extract<TaskFormField, { type: "number" }>[],
  values: Record<string, unknown>,
  bad: Set<string>,
  stamp: { date: string; time: string } | null,
  marks: ObjectMarks = { off: new Set(), statusKeys: new Set(), statuses: {} }
): string {
  // Один стиль для холодильников и складов: название объекта целиком, под ним поля во всю ширину
  // («Температура», «Влажность», «1-й замер», «2-й замер»), показание крупно по центру.
  const inputs = group
    .map((field) => {
      const id = `f-${field.key}`;
      const raw = values[field.key];
      const value = raw === null || raw === undefined ? "" : String(raw);
      const norm = normRange(field);
      const required = field.required === true;
      const unit = field.unit ? ` ${field.unit}` : "";
      const normText = norm.min != null && norm.max != null ? `${norm.min}…${norm.max}${unit}` : "";
      const withStatuses = marks.statusKeys.has(field.key);
      const statusMark = withStatuses ? marks.statuses[field.key] ?? null : null;
      // Отметка сильнее «Выключено» — так же решает сервер, если форма без скриптов прислала обе.
      const isOff = !statusMark && marks.off.has(field.key);
      const isMarked = isOff || statusMark !== null;
      const offNote = metricName(field) === "Влажность" ? OFF_NOTE_READING : OFF_NOTE_EQUIPMENT;
      const labelBody = `${esc(metricName(field))}${stampHtml(stamp)}${required ? `<span class="req" aria-hidden="true">*</span>` : ""}`;
      const status = statusMark
        ? statusMarkNote(statusMark)
        : isOff
          ? `${offNote} — руководитель получит уведомление`
          : bad.has(field.key)
            ? `Вне нормы ${normText}`
            : normText
              ? `Норма ${normText}`
              : "";
      const input = `<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" inputmode="decimal" value="${isMarked ? "" : esc(value)}" placeholder=" "${norm.min != null ? ` data-min="${esc(norm.min)}"` : ""}${norm.max != null ? ` data-max="${esc(norm.max)}"` : ""}${field.unit ? ` data-unit="${esc(field.unit)}"` : ""} data-plain="1" data-label="${esc(`${base} · ${lower(metricName(field))}`)}"${required && !isMarked ? ` aria-required="true"` : ""}${required && isMarked ? ` data-req="1"` : ""}>`;
      const box = `<div class="box">${stepButton(field.key, -1)}${input}<label for="${esc(id)}">${labelBody}</label><span class="pill" aria-hidden="true"></span>${stepButton(field.key, 1)}</div>`;
      const offChip = `<div class="chips offrow"><label class="chip offc${isOff ? " on" : ""}"><input type="checkbox" name="off:${esc(field.key)}" value="1"${isOff ? " checked" : ""}>${esc(offNote)}</label></div>`;
      // Холодильник: рядом с «Выключено» — «Обслуживание» и «Ремонт» (в журнале «обсл»/«рем», как с наклейки).
      const statusChips = withStatuses
        ? `<div class="chips offrow sts" role="group" aria-label="Вместо температуры">${COLD_EQUIPMENT_STATUSES.map(
            (option) =>
              `<label class="chip offc${statusMark === option ? " on" : ""}"><input type="radio" name="status:${esc(field.key)}" value="${option}"${statusMark === option ? " checked" : ""}>${esc(COLD_EQUIPMENT_STATUS_TITLE[option])}</label>`
          ).join("")}</div>`
        : "";
      return `<div class="fl up has-step big${bad.has(field.key) ? " bad" : ""}${isMarked ? " is-off" : ""}">${box}<p class="st">${esc(status)}</p>${quickChips(field.key, norm, isMarked ? "" : value)}${offChip}${statusChips}</div>`;
    })
    .join("");
  return `<div class="obj"><div class="obj-t">${esc(base)}</div><div class="cols one">${inputs}</div></div>`;
}

/** Кнопка шага по бокам поля: числа ±1, время ±5 минут. */
function stepButton(fieldKey: string, delta: number): string {
  const minus = delta < 0;
  return `<button type="button" class="stp ${minus ? "minus" : "plus"}" data-step="${esc(fieldKey)}" data-delta="${delta}" aria-label="${minus ? "Минус" : "Плюс"}">${minus ? "−" : "+"}</button>`;
}

/** «· 20.09.2026 18:31» после названия показания — видно, за какой момент вносится. */
function stampHtml(stamp: { date: string; time: string } | null): string {
  return stamp ? ` · <span class="stamp" data-stamp-date="${esc(stamp.date)}">${esc(stamp.date)} ${esc(stamp.time)}</span>` : "";
}

/** Быстрый ввод под полем с нормой: нижняя, середина, верхняя граница. */
function quickChips(fieldKey: string, norm: { min: number | null; max: number | null }, current: string): string {
  const values = quickValues(norm.min, norm.max);
  if (values.length === 0) return "";
  const now = current.trim().replace(",", ".");
  return `<div class="chips qv">${values
    .map((value) => `<button type="button" class="chip${value === now ? " on" : ""}" data-fill="${esc(fieldKey)}" data-value="${esc(value)}">${esc(value)}</button>`)
    .join("")}</div>`;
}

function chips(fieldKey: string, values: readonly string[], current: string): string {
  if (values.length === 0) return "";
  return `<div class="chips">${values
    .map((value) => `<button type="button" class="chip${value === current ? " on" : ""}" data-fill="${esc(fieldKey)}" data-value="${esc(value)}">${esc(value)}</button>`)
    .join("")}</div>`;
}

function renderField(field: TaskFormField, raw: unknown, hints: JournalFillHints, suggestions: Suggestions, bad: boolean, stamp: { date: string; time: string } | null = null): string {
  const id = `f-${field.key}`;
  const value = raw === null || raw === undefined ? "" : String(raw);
  const required = "required" in field && field.required === true;
  const label = `<label for="${esc(id)}">${esc(field.type === "number" ? cleanLabel(field.label) : field.label)}${required ? `<span class="req" aria-hidden="true">*</span>` : ""}</label>`;
  // Подпись внутри поля (плавающая): порядок «input, label» нужен CSS.
  const fl = (input: string, opts: { up?: boolean; after?: string; extraClass?: string } = {}) =>
    `<div class="fl${bad ? " bad" : ""}${opts.up ? " up" : ""}${opts.extraClass ?? ""}">${input}${label}${opts.after ?? ""}</div>`;
  const placeholder = "placeholder" in field && field.placeholder ? field.placeholder : " ";
  const req = required ? ` aria-required="true"` : "";

  switch (field.type) {
    case "text": {
      const scope = hints.nameFields?.[field.key];
      const list = scope ? (suggestions[scope]?.values ?? []) : [];
      const choices = hints.choices?.[field.key] ?? [];
      if (field.multiline) {
        return (
          fl(`<textarea class="in" id="${esc(id)}" name="${esc(field.key)}" rows="${choices.length > 0 ? 2 : 3}" placeholder=" "${field.maxLength ? ` maxlength="${field.maxLength}"` : ""}${req}>${esc(value)}</textarea>`) +
          chips(field.key, choices, value)
        );
      }
      const datalist = list.length > 0 ? `<datalist id="dl-${esc(field.key)}">${list.slice(0, 50).map((item) => `<option value="${esc(item)}"></option>`).join("")}</datalist>` : "";
      const isTemp = hints.tempField?.tempKey === field.key;
      return (
        fl(
          `<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"${field.maxLength ? ` maxlength="${field.maxLength}"` : ""}${list.length > 0 ? ` list="dl-${esc(field.key)}" autocomplete="off"` : ""}${req}>${datalist}`,
          { up: placeholder !== " ", after: isTemp ? `<p class="st" id="temp-hint" hidden>Подставлено по прошлой записи этого блюда — поправьте, если сегодня иначе.</p>` : "" }
        ) + chips(field.key, list.slice(0, 6), value) + chips(field.key, choices, value)
      );
    }
    case "number": {
      const norm = normRange(field);
      const fromLabel = /норма/i.test(field.label);
      const unit = field.unit ? ` ${field.unit}` : "";
      // Норму показываем, только если она задана в подписи; физические пределы валидатора — не норма.
      const status = fromLabel && norm.min != null && norm.max != null ? `Норма ${esc(norm.min)}…${esc(norm.max)}${esc(unit)}` : "";
      const isTemp = hints.tempField?.tempKey === field.key;
      const numLabel = `<label for="${esc(id)}">${esc(cleanLabel(field.label))}${stampHtml(stamp)}${required ? `<span class="req" aria-hidden="true">*</span>` : ""}</label>`;
      const input = `<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" inputmode="decimal" value="${esc(value)}" placeholder=" "${norm.min != null ? ` data-min="${esc(norm.min)}"` : ""}${norm.max != null ? ` data-max="${esc(norm.max)}"` : ""}${field.unit ? ` data-unit="${esc(field.unit)}"` : ""}${fromLabel ? ` data-plain="1"` : ""} data-label="${esc(cleanLabel(field.label))}"${req}>`;
      // «−»/«+» по бокам: на телефоне крутить цифру быстрее, чем набирать; минуса на цифровой клавиатуре нет.
      return `<div class="fl up has-step${bad ? " bad" : ""}"><div class="box">${stepButton(field.key, -1)}${input}${numLabel}<span class="pill" aria-hidden="true"></span>${stepButton(field.key, 1)}</div>${status ? `<p class="st">${status}</p>` : `<p class="st"></p>`}${isTemp ? `<p class="st" id="temp-hint" hidden>Подставлено по прошлой записи этого блюда — поправьте, если сегодня иначе.</p>` : ""}${fromLabel ? quickChips(field.key, norm, value) : ""}</div>`;
    }
    case "boolean": {
      const checked = raw === true || raw === "on" || raw === "true";
      return `<label class="check${bad ? " bad" : ""}"><input type="checkbox" id="${esc(id)}" name="${esc(field.key)}" value="on"${checked ? " checked" : ""}><span>${esc(field.label)}</span></label>`;
    }
    case "select": {
      // Ряд крупных кнопок (radio) вместо списка — работает и без скриптов.
      const seg = hints.segmented?.[field.key];
      if (seg) {
        const buttons = field.options
          .map((option) => {
            const checked = option.value === value;
            return `<label class="segb${checked ? " on" : ""}"><input type="radio" name="${esc(field.key)}" value="${esc(option.value)}"${checked ? " checked" : ""}${required ? " required" : ""}><span>${esc(seg[option.value] ?? option.label)}</span></label>`;
          })
          .join("");
        return `<div class="fl up seg-wrap${bad ? " bad" : ""}"><p class="lab">${esc(field.label)}${required ? `<span class="req" aria-hidden="true">*</span>` : ""}</p><div class="seg">${buttons}</div></div>`;
      }
      return fl(
        `<select class="in" id="${esc(id)}" name="${esc(field.key)}"${req}>${value === "" ? `<option value="">Выберите</option>` : ""}${field.options
          .map((option) => `<option value="${esc(option.value)}"${option.value === value ? " selected" : ""}>${esc(option.label)}</option>`)
          .join("")}</select>`,
        { up: true }
      );
    }
    case "date":
      return fl(`<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="date" value="${esc(value)}"${req}>`, { up: true });
    case "time": {
      const offsets = hints.timeOffsetFields?.includes(field.key)
        ? `<div class="chips">${[...TIME_OFFSET_CHIPS, { minutes: 0, label: "Сейчас" }]
            .map((chip) => `<button type="button" class="chip" data-fill="${esc(field.key)}" data-ago="${chip.minutes}">${esc(chip.label)}</button>`)
            .join("")}</div>`
        : "";
      // ±5 минут кнопками по бокам, чипы «−15 … Сейчас» под полем.
      return `<div class="fl up has-step${bad ? " bad" : ""}"><div class="box">${stepButton(field.key, -5)}<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="time" step="60" value="${esc(value)}"${req}>${label}${stepButton(field.key, 5)}</div></div>${offsets}`;
    }
    case "photo":
      return `<div class="photo">${esc(field.label)}: фото к этой записи можно приложить в кабинете или в приложении.</div>`;
    case "signature":
      return fl(`<input class="in" id="${esc(id)}" name="${esc(field.key)}" type="text" value="${esc(value)}" placeholder=" " autocomplete="name"${req}>`);
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
  /** Сколько карточек отмечено «Выключено / Нет показания» — руководитель уведомлён. */
  offCount?: number;
  /** Сколько холодильников отмечено «Обслуживание»/«Ремонт» — в журнале «обсл»/«рем». */
  statusCount?: number;
  /** Своя строка заголовка — «Добавлено блюд: 7», «Подписано: 5». */
  headline?: string | null;
  /** Подпись кнопки под галкой (по умолчанию «Добавить ещё»). */
  addMoreLabel?: string;
}): string {
  const offLine = params.offCount && params.offCount > 0
    ? `<p class="muted" style="margin-top:6px">Отмечено «Выключено / Нет показания»: ${params.offCount}. В журнале прочерк с пометкой, руководитель получил уведомление.</p>`
    : "";
  const statusLine = params.statusCount && params.statusCount > 0
    ? `<p class="muted" style="margin-top:6px">Отмечено «Обслуживание» или «Ремонт»: ${params.statusCount}. В журнале вместо температуры «${COLD_EQUIPMENT_STATUS_SHORT.service}» или «${COLD_EQUIPMENT_STATUS_SHORT.repair}».</p>`
    : "";
  // Экран успеха остаётся в этом журнале: переходов в другие журналы здесь нет
  // (владелец, 2026-09-21) — только «Добавить ещё» для строчных журналов.
  const headline = params.headline ?? (params.mode === "appended" ? "Строка добавлена" : "Отметка записана");
  return `<div class="card center" role="status" aria-live="polite"><div class="ok">${qrCheckHtml({ size: 112 })}</div><h2>${esc(headline)}</h2><p class="muted" style="margin-top:8px">Сохранено: ${esc(params.documentTitle)} · ${esc(params.employeeName)} · ${esc(params.timeLabel)}</p>${offLine}${statusLine}${
    params.addMoreHref ? `<div class="sticky"><a class="btn" href="${esc(params.addMoreHref)}">${esc(params.addMoreLabel ?? "Добавить ещё")}</a></div>` : ""
  }</div>`;
}

/**
 * Выход и время изготовления из меню мастер-кабинета для инлайн-скрипта:
 * `{ "борщ": { p: "250", h: "08:30" } }`. Нет таких блюд — null (форма как раньше).
 */
export function menuMetaScript(hints: JournalFillHints, suggestions: Suggestions, fieldKeys: readonly string[]): string | null {
  const fields = hints.menuFields;
  if (!fields || !fieldKeys.includes(fields.nameKey)) return null;
  const scope = hints.nameFields?.[fields.nameKey];
  if (!scope) return null;
  const portionKey = fields.portionKey && fieldKeys.includes(fields.portionKey) ? fields.portionKey : null;
  const timeKey = fields.timeKey && fieldKeys.includes(fields.timeKey) ? fields.timeKey : null;
  if (!portionKey && !timeKey) return null;
  const map: Record<string, { p?: string; h?: string }> = {};
  for (const [key, value] of Object.entries(suggestions[scope]?.meta ?? {})) {
    const entry: { p?: string; h?: string } = {};
    if (portionKey && value.portionWeight) entry.p = value.portionWeight;
    if (timeKey && value.productionTime) entry.h = value.productionTime;
    if (entry.p || entry.h) map[suggestionKey(key)] = entry;
  }
  if (Object.keys(map).length === 0) return null;
  return `window.__qrMenu=${jsonForScript(map)};window.__qrMenuKeys=${jsonForScript({ name: fields.nameKey, portion: portionKey, time: timeKey })};`;
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
