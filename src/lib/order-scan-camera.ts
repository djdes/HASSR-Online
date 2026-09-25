/**
 * «Камера» для приказов к журналу (2026-09-25): на телефоне приказ снимают
 * сразу камерой, фото уходит как скан JPG в тот же `/api/journal-order-scans`,
 * что и обычная загрузка. Права — те же: сервер пускает только руководство
 * (сессия кабинета + `canManageOrderScans`), QR-страница лишь показывает
 * кнопку тем же людям.
 *
 * Фото телефона уменьшается до `ORDER_SCAN_PHOTO_MAX_SIDE` по длинной стороне
 * и сохраняется JPEG: 12-мегапиксельный снимок иначе весит 5–10 МБ и
 * упирается в лимит, а для чтения приказа хватает 2400 px.
 */

export const ORDER_SCAN_PHOTO_MAX_SIDE = 2400;
export const ORDER_SCAN_PHOTO_QUALITY = 0.85;
/** `accept` + `capture` для input: сразу камера (задняя), только картинки. */
export const ORDER_SCAN_CAMERA_ACCEPT = "image/jpeg,image/png,image/*";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** «Приказ — фото 25.09.2026 14:05»: название по умолчанию, потом можно переименовать. */
export function orderScanPhotoTitle(at: Date): string {
  return `Приказ — фото ${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Имя файла снимка: `prikaz-2026-09-25-1405.jpg`. */
export function orderScanPhotoFileName(at: Date): string {
  return `prikaz-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.jpg`;
}

/** Размер после уменьшения: длинная сторона не больше `max`, пропорции те же. */
export function fitOrderScanPhoto(width: number, height: number, max = ORDER_SCAN_PHOTO_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Снимок камеры → JPEG-файл для загрузки (только в браузере). Не удалось
 * прочитать картинку (старый браузер, HEIC без поддержки) — отдаём исходный
 * файл: сервер сам объяснит, что не так с форматом.
 */
export async function orderScanPhotoToJpeg(file: File, at: Date = new Date()): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const size = fitOrderScanPhoto(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", ORDER_SCAN_PHOTO_QUALITY));
    if (!blob) return file;
    return new File([blob], orderScanPhotoFileName(at), { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Кнопку камеры видят устройства с сенсорным экраном — телефоны и планшеты
 * любой ширины (`any-pointer: coarse` покрывает и `pointer: coarse`). На
 * компьютере с мышью её нет: там приказ загружают файлом в кабинете.
 */
export const ORDER_SCAN_TOUCH_MEDIA = "(any-pointer: coarse)";

/**
 * Блок «Приказы к журналу» на QR-странице журнала (гигиена, бракераж готовой
 * продукции) — только для руководства, вошедшего в кабинет на этом телефоне.
 * Без скриптов работает как обычная форма; со скриптами — фото уменьшается и
 * уходит в фоне, результат пишется под кнопкой. `cabinetHref` — страница
 * журнала в кабинете: с компьютера приказ загружают там.
 */
export function renderOrderScanCamera(params: { code: string; count: number; example: string; max: number; cabinetHref?: string | null }): string {
  const full = params.count >= params.max;
  return `<section class="card oscan" id="order-scans" data-code="${esc(params.code)}">
<p class="label">Приказы к журналу</p>
<p class="muted oscan-t">Например, ${esc(params.example)}. Загружено: <b id="oscan-count">${params.count}</b>. Фото добавится как скан — в печать журнала и проверяющему.</p>
${
  full
    ? `<p class="muted oscan-t">Не больше ${params.max} файлов — лишний приказ удалите в кабинете.</p>`
    : `<form method="post" action="/api/journal-order-scans" enctype="multipart/form-data" id="oscan-form">
<input type="hidden" name="code" value="${esc(params.code)}">
<label class="btn second oscan-cam" for="oscan-file"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg><span>Сфотографировать приказ</span></label>
<input id="oscan-file" class="oscan-in" type="file" name="file" accept="${ORDER_SCAN_CAMERA_ACCEPT}" capture="environment">
<noscript><button class="btn" type="submit">Загрузить</button></noscript>
</form>
<p class="muted oscan-t oscan-desk">Сфотографировать приказ можно с телефона или планшета. С компьютера загрузите файл в кабинете${
        params.cabinetHref ? ` — <a href="${esc(params.cabinetHref)}">открыть журнал</a>` : ""
      }.</p>
<p class="oscan-st" id="oscan-status" role="status" aria-live="polite" hidden></p>`
}
</section>`;
}

export const ORDER_SCAN_CAMERA_CSS = `
.oscan{margin-top:18px}
.oscan-t{font-size:15px;margin:0 0 12px}
.oscan-cam{gap:10px;min-height:56px;font-size:17px}
.btn.oscan-cam{display:none}
@media ${ORDER_SCAN_TOUCH_MEDIA}{.btn.oscan-cam{display:flex}.oscan-desk{display:none}}
.oscan-in{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.oscan-st{margin:10px 2px 0;font-size:16px;line-height:1.4;color:#116b2a}
.oscan-st.bad{color:#a13a32}
`;

/**
 * Скрипт блока: выбрали фото → уменьшили до JPEG → POST в API приказов с
 * cookie кабинета. Алгоритм тот же, что у `orderScanPhotoToJpeg`.
 */
export const ORDER_SCAN_CAMERA_JS = `(function(){
  var input=document.getElementById("oscan-file"); var st=document.getElementById("oscan-status"); var box=document.getElementById("order-scans");
  if(!input||!st||!box) return;
  var label=box.querySelector(".oscan-cam span");
  function p(n){return (n<10?"0":"")+n;}
  function say(t,bad){st.hidden=false;st.textContent=t;st.className="oscan-st"+(bad?" bad":"");}
  function toJpeg(file){
    return new Promise(function(done){
      if(!window.createImageBitmap){done(file);return;}
      createImageBitmap(file,{imageOrientation:"from-image"}).then(function(bm){
        var max=${ORDER_SCAN_PHOTO_MAX_SIDE}, w=bm.width, h=bm.height, k=Math.max(w,h)>max?max/Math.max(w,h):1;
        var c=document.createElement("canvas"); c.width=Math.max(1,Math.round(w*k)); c.height=Math.max(1,Math.round(h*k));
        var x=c.getContext("2d"); if(!x){done(file);return;}
        x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.drawImage(bm,0,0,c.width,c.height);
        c.toBlob(function(b){ if(!b){done(file);return;} var d=new Date();
          done(new File([b],"prikaz-"+d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"-"+p(d.getHours())+p(d.getMinutes())+".jpg",{type:"image/jpeg"})); },"image/jpeg",${ORDER_SCAN_PHOTO_QUALITY});
      }).catch(function(){done(file);});
    });
  }
  input.addEventListener("change",function(){
    var f=input.files&&input.files[0]; if(!f) return;
    input.disabled=true; if(label) label.textContent="Загружаем…"; say("Загружаем фото…",false);
    toJpeg(f).then(function(file){
      var d=new Date(); var fd=new FormData();
      fd.append("code",box.getAttribute("data-code")||""); fd.append("file",file);
      fd.append("title","Приказ — фото "+p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes()));
      return fetch("/api/journal-order-scans",{method:"POST",body:fd,credentials:"same-origin"}).then(function(r){
        return r.json().catch(function(){return null;}).then(function(j){
          if(!r.ok) throw new Error((j&&j.error)||"Не удалось загрузить приказ");
          var n=document.getElementById("oscan-count"); if(n) n.textContent=String(Number(n.textContent||"0")+1);
          say("Приказ «"+((j&&j.scan&&j.scan.title)||"фото")+"» добавлен — он печатается после страниц журнала.",false);
        });
      });
    }).catch(function(e){ say(e&&e.message?e.message:"Нет связи с сервером — попробуйте ещё раз",true); })
      .then(function(){ input.disabled=false; input.value=""; if(label) label.textContent="Сфотографировать ещё"; });
  });
})();`;
