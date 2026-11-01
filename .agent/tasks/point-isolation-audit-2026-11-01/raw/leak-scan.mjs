// Динамический поиск утечек (локальная wesetup_iso, dev на 3020 — не прод).
// Обходит GET-маршруты API и страницы кабинета от лица людей точки А, руководства,
// выбравшего точку А в шапке, и второй организации; ищет в ответах метки точки Б
// (и точки А — для людей точки Б) и чужой организации.
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/leak-scan.mjs [out-file] [filter]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fx, login, req, withPoint } from "./http-lib.mjs";

const outFile = process.argv[2] ?? "leak-scan.txt";
const filter = process.argv[3] ?? "";

const SKIP_API = [
  "/api/cron", "/api/auth", "/api/payments", "/api/webhooks", "/api/dev", "/api/telegram", "/api/tuya",
  "/api/mailing", "/api/root", "/api/health", "/api/healthz", "/api/build-info", "/api/runtime-probe",
  "/api/status", "/api/legal", "/api/kp", "/api/promo", "/api/live", "/api/notifications/telegram",
  "/api/max/webhook",
];

function walk(dir, file, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, file, acc);
    else if (name === file) acc.push(full);
  }
  return acc;
}
const toUrl = (file, root) =>
  file.replace(root, "").replace(/\/(route\.ts|page\.tsx)$/, "").replace(/\/\([^)]*\)/g, "") || "/";

const apiRoutes = walk("src/app/api", "route.ts")
  .filter((file) => /export (async function|const) GET\b|export \{[^}]*\bGET\b/.test(readFileSync(file, "utf8")))
  .map((file) => toUrl(file, "src/app"))
  .filter((url) => !SKIP_API.some((prefix) => url === prefix || url.startsWith(`${prefix}/`)));
const pages = walk("src/app/(dashboard)", "page.tsx").map((file) => toUrl(file, "src/app/(dashboard)"));

const B = fx.data.B;
const A = fx.data.A;
// Подстановка id объектов чужой точки в динамические адреса.
const dynamicFor = (url, side) => {
  const d = side === "B" ? B : A;
  const k = side;
  const map = [
    [/^\/api\/batches\/\[id\]$/, `/api/batches/${d.batch}`],
    [/^\/api\/equipment\/\[id\]\/usage$/, `/api/equipment/${k === "B" ? fx.fridgeB : fx.fridgeA}/usage`],
    [/^\/api\/areas\/\[id\]\/usage$/, `/api/areas/${k === "B" ? fx.areaB : fx.areaA}/usage`],
    [/^\/api\/settings\/rooms\/\[id\]\/usage$/, `/api/settings/rooms/${k === "B" ? fx.roomB : fx.roomA}/usage`],
    [/^\/api\/journal-documents\/\[id\]$/, `/api/journal-documents/${fx.docs.hygiene[k]}`],
    [/^\/api\/journal-documents\/\[id\]\/verifier$/, `/api/journal-documents/${fx.docs.hygiene[k]}/verifier`],
    [/^\/api\/journal-documents\/\[id\]\/pdf$/, `/api/journal-documents/${fx.docs.hygiene[k]}/pdf`],
    [/^\/api\/print\/jobs\/\[id\]\/pdf$/, `/api/print/jobs/${d.printJob}/pdf`],
    [/^\/api\/staff\/\[id\]\/personal-qr$/, `/api/staff/${k === "B" ? fx.users.cookB.id : fx.users.cookA.id}/personal-qr`],
    [/^\/api\/staff\/\[id\]\/qr-pin$/, `/api/staff/${k === "B" ? fx.users.cookB.id : fx.users.cookA.id}/qr-pin`],
    [/^\/api\/users\/\[id\]\/access$/, `/api/users/${k === "B" ? fx.users.cookB.id : fx.users.cookA.id}/access`],
    [/^\/api\/journal-task-pool\/\[code\]$/, `/api/journal-task-pool/cold_equipment_control`],
    [/^\/api\/settings\/journal-scope\/\[code\]$/, `/api/settings/journal-scope/hygiene`],
    [/^\/api\/settings\/brakerage-commission\/\[code\]$/, `/api/settings/brakerage-commission/finished_product`],
    [/^\/api\/journal-scans\/\[code\]$/, `/api/journal-scans/hygiene`],
    [/^\/api\/settings\/supply\/\[provider\]\/stores$/, `/api/settings/supply/iiko/stores`],
    [/^\/batches\/\[id\]$/, `/batches/${d.batch}`],
    [/^\/capa\/\[id\]$/, `/capa/${d.capa}`],
    [/^\/edo\/\[id\]$/, `/edo/${d.supply}`],
    [/^\/journals\/\[code\]$/, [`/journals/hygiene`, `/journals/cold_equipment_control`, `/journals/cleaning`]],
    [/^\/journals\/\[code\]\/documents\/\[docId\]$/, [
      `/journals/hygiene/documents/${fx.docs.hygiene[k]}`,
      `/journals/cold_equipment_control/documents/${fx.docs.cold_equipment_control[k]}`,
      `/journals/cleaning/documents/${fx.docs.cleaning[k]}`,
    ]],
    [/^\/journals\/\[code\]\/documents\/\[docId\]\/verify$/, `/journals/hygiene/documents/${fx.docs.hygiene[k]}/verify`],
    [/^\/journals\/\[code\]\/new$/, `/journals/hygiene/new`],
    [/^\/reports\/by-user\/\[id\]$/, `/reports/by-user/${k === "B" ? fx.users.cookB.id : fx.users.cookA.id}`],
    [/^\/settings\/buildings\/\[id\]$/, `/settings/buildings/${k === "B" ? fx.pointB : fx.pointA}`],
    [/^\/settings\/users\/\[id\]\/access$/, `/settings/users/${k === "B" ? fx.users.cookB.id : fx.users.cookA.id}/access`],
    [/^\/settings\/journals\/\[code\]\/scope$/, `/settings/journals/hygiene/scope`],
  ];
  for (const [re, value] of map) if (re.test(url)) return Array.isArray(value) ? value : [value];
  return [];
};

const expand = (list, side) =>
  list.flatMap((url) => (url.includes("[") ? dynamicFor(url, side) : [url])).filter((url) => !filter || url.includes(filter));

// Метки: объекты точки Б, люди точки Б, документы и записи точки Б.
const markersOf = (side) => {
  const tag = side === "B" ? "Бета" : "Альфа";
  const d = side === "B" ? B : A;
  const k = side;
  const names = [
    `ШХ ${tag}`, `Цех ${tag}`, `Зал ${tag}`, `Повар ${tag}`, `Руководитель ${tag}`, `CAPA ${tag}`, `Партия ${tag}`,
    `Списание ${tag}`, `НАКЛ-${tag}`, `Поставщик ${tag}`, `Этикетка ${tag}`, `Продукт ${tag}`, `Принтер ${tag}`,
    `Печать ${tag}`, `Проверяющий ${tag}`, `Навык ${tag}`, `Уведомление ${tag}`, `Гигиена ${tag}`, `Здоровье ${tag}`,
    `Запись ${tag}`,
  ];
  const ids = [
    k === "B" ? fx.fridgeB : fx.fridgeA, k === "B" ? fx.areaB : fx.areaA, k === "B" ? fx.roomB : fx.roomA,
    k === "B" ? fx.users.cookB.id : fx.users.cookA.id, k === "B" ? fx.users.headB.id : fx.users.headA.id,
    ...Object.values(d), ...Object.values(fx.docs).map((byPoint) => byPoint[k]).filter(Boolean),
  ];
  return { names, ids };
};
const org2Markers = { names: ["ISO Чужая", "ШХ Чужой", "Цех Чужой", "Владелец Чужой"], ids: [fx.org2.orgId, fx.org2.fridge, fx.org2.area, fx.org2.owner.id, ...Object.values(fx.org2.docs).map((m) => m.shared)] };
const org1Markers = { names: ["ISO Точки", "Альфа", "Бета"], ids: [fx.orgId, fx.pointA, fx.pointB, fx.office, fx.fridgeA, fx.fridgeB] };

const found = (text, markers) => [...markers.names.filter((m) => text.includes(m)), ...markers.ids.filter((m) => text.includes(m)).map((m) => `id:${m.slice(-6)}`)];

const results = [];
const log = (line) => {
  results.push(line);
  console.log(line);
};

async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (error) {
        log(`ERROR ${item.actor} ${item.url} ${String(error).slice(0, 120)}`);
      }
    }
  }));
}

const cookA = await login(fx.users.cookA.email);
const headA = await login(fx.users.headA.email);
const cookB = await login(fx.users.cookB.email);
const owner = await login(fx.users.owner.email);
const office = await login(fx.users.officeMgr.email);
const owner2 = await login(fx.org2.owner.email);

const actors = [
  // Люди точки А и руководство, выбравшее точку А: не должно быть меток точки Б.
  { name: "cookA", cookie: cookA, foreign: "B", strictPoint: true },
  { name: "headA", cookie: headA, foreign: "B", strictPoint: true },
  { name: "ownerA", cookie: withPoint(owner, fx.pointA), foreign: "B", strictPoint: false },
  { name: "officeA", cookie: withPoint(office, fx.pointA), foreign: "B", strictPoint: false },
  // Повар точки Б: не должно быть меток точки А.
  { name: "cookB", cookie: cookB, foreign: "A", strictPoint: true },
  // Вторая организация: не должно быть меток первой.
  { name: "org2", cookie: owner2, cross: true },
  // Владелец первой организации: не должно быть меток второй.
  { name: "ownerOrg", cookie: withPoint(owner, "organization"), cross2: true },
];

const items = [];
for (const actor of actors) {
  const side = actor.foreign ?? "B";
  for (const url of [...expand(apiRoutes, side), ...expand(pages, side)]) items.push({ actor: actor.name, url, actorObj: actor });
}
log(`INFO маршрутов API ${apiRoutes.length}, страниц ${pages.length}, запросов ${items.length}`);

await pool(items, 6, async ({ actorObj: actor, url }) => {
  const res = await req("GET", url, actor.cookie);
  const text = res.text ?? "";
  let hits = [];
  if (actor.cross) hits = found(text, org1Markers);
  else if (actor.cross2) hits = found(text, org2Markers);
  else {
    const m = markersOf(actor.foreign);
    hits = found(text, m);
    if (actor.strictPoint) {
      const pointId = actor.foreign === "B" ? fx.pointB : fx.pointA;
      const pointName = actor.foreign === "B" ? "Точка Б" : "Точка А";
      if (text.includes(pointId)) hits.push("id:точки");
      if (text.includes(pointName)) hits.push(pointName);
    }
  }
  if (hits.length > 0) log(`LEAK ${actor.name} ${res.status} ${url} :: ${[...new Set(hits)].join(", ")}`);
  else if (res.status >= 500) log(`E500 ${actor.name} ${url}`);
});

writeFileSync(`.agent/tasks/point-isolation-audit-2026-11-01/raw/${outFile}`, `${results.sort().join("\n")}\n`);
console.log("done", results.filter((r) => r.startsWith("LEAK")).length);
