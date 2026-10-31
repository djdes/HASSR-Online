// e2e-база (dev на порту 3024), не прод: поставки по точкам.
// node .agent/tasks/point-supply-2026-10-31/raw/http-check.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/point-supply-2026-10-31/raw";
const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const base = process.env.BASE_URL ?? "http://localhost:3024";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

async function login(email) {
  const jar = new Map();
  const keep = (res) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: fx.password, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`вход не удался: ${email} (${res.status})`);
  return cookie();
}

const page = async (path, cookie) => {
  const res = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
};
const post = async (path, cookie, body) => {
  const res = await fetch(`${base}${path}`, {
    method: path.includes("/stores") ? "PUT" : "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const acceptBody = (buildingId) => ({
  delivery: { transportOk: true, documentsOk: true },
  items: [{ line: 1, decision: "accept", packagingOk: true, organolepticOk: true }],
  ...(buildingId === undefined ? {} : { buildingId }),
});
const M = fx.mark;

check("накладная с грузополучателем точки А получила точку А по КПП", fx.kppDocPoint === fx.pointA, String(fx.kppDocPoint));

// Руководитель точки А.
{
  const cookie = await login(fx.headA);
  const inbox = await page("/edo", cookie);
  check("«Входящие» точки А: своя накладная (по КПП) есть", inbox.text.includes(`${M} Поставщик по КПП`), `HTTP ${inbox.status}`);
  check("«Входящие» точки А: накладная без точки есть", inbox.text.includes(`${M} Поставщик без точки`));
  check("«Входящие» точки А: накладной точки Б нет", !inbox.text.includes(`${M} Поставщик точки Б`));
  const foreign = await page(`/edo/${fx.pointBDocId}`, cookie);
  // Next отдаёт «не найдено» потоком (код 200 после начала ответа) — проверяем содержимое.
  check(
    "накладная точки Б для руководителя точки А — «не найдено», данных накладной нет",
    (foreign.status === 404 || foreign.text.includes("NEXT_HTTP_ERROR_FALLBACK;404")) && !foreign.text.includes(`${M} Поставщик точки Б`),
    `HTTP ${foreign.status}`,
  );
  const form = await page(`/edo/${fx.noPointDocId}`, cookie);
  check("форма приёмки: блок «Точка приёмки»", form.text.includes("data-edo-point-picker") && form.text.includes("Точка приёмки"));
  const missing = await post(`/api/edo/documents/${fx.noPointDocId}/accept`, cookie, acceptBody(undefined));
  check("приёмка без точки — 400 «Выберите точку»", missing.status === 400 && missing.body?.errorCode === "point_required", JSON.stringify(missing.body));
  const forbidden = await post(`/api/edo/documents/${fx.noPointDocId}/accept`, cookie, acceptBody(fx.pointB));
  check("приёмка на чужую точку Б — 403", forbidden.status === 403 && forbidden.body?.errorCode === "point_forbidden", JSON.stringify(forbidden.body));
  const foreignAccept = await post(`/api/edo/documents/${fx.pointBDocId}/accept`, cookie, acceptBody(fx.pointA));
  check("приёмка накладной точки Б руководителем точки А — 404", foreignAccept.status === 404, `HTTP ${foreignAccept.status}`);
  const ok = await post(`/api/edo/documents/${fx.noPointDocId}/accept`, cookie, acceptBody(fx.pointA));
  check("приёмка на свою точку А — 200, строка в журнале", ok.status === 200 && ok.body?.rowIds?.length === 1, JSON.stringify(ok.body).slice(0, 160));
  writeFileSync(`${dir}/accepted.json`, JSON.stringify({ journalDocumentId: ok.body?.journalDocumentId ?? null }, null, 2));
  const labels = await page("/settings/print-agent/labels?period=7d", cookie);
  check("журнал маркировки точки А: её этикетка и общая", labels.text.includes(`${M} Этикетка А`) && labels.text.includes(`${M} Этикетка общая`), `HTTP ${labels.status}`);
  check("журнал маркировки точки А: этикетки точки Б нет", !labels.text.includes(`${M} Этикетка Б`));
  const losses = await page("/losses", cookie);
  check("потери точки А: её запись и запись без места", losses.text.includes(`${M} Потеря А`) && losses.text.includes(`${M} Потеря общая`), `HTTP ${losses.status}`);
  check("потери точки А: записи точки Б нет", !losses.text.includes(`${M} Потеря Б`));
}

// Руководство на всю сеть («Вся организация»).
{
  const cookie = await login(fx.owner);
  const inbox = await page("/edo?tab=done", cookie);
  const pending = await page("/edo", cookie);
  check("«Вся организация»: накладная точки Б видна", pending.text.includes(`${M} Поставщик точки Б`), `HTTP ${pending.status}`);
  check("«Вся организация»: у накладных пометка точки", pending.text.includes("data-edo-point") && pending.text.includes("Точка: Точка Б"));
  check("«Вся организация»: принятая накладная — в разобранных с точкой А", inbox.text.includes(`${M} Поставщик без точки`) && inbox.text.includes("Точка: Точка А"));
  const losses = await page("/losses", cookie);
  check("«Вся организация»: все потери", ["А", "Б", "общая"].every((key) => losses.text.includes(`${M} Потеря ${key}`)));
  const badMap = await post("/api/settings/supply/iiko/stores", cookie, { map: { "st-kitchen": "not-a-point" } });
  check("склады iiko: чужая точка — 400", badMap.status === 400, JSON.stringify(badMap.body));
  const goodMap = await post("/api/settings/supply/iiko/stores", cookie, { map: { "st-kitchen": fx.pointA, "st-bar": "skip" } });
  check("склады iiko: склад → точка А и «не загружать» сохранены", goodMap.status === 200 && goodMap.body?.map?.["st-kitchen"] === fx.pointA, JSON.stringify(goodMap.body));
  const settings = await page("/settings/integrations/iiko", cookie);
  check("настройки iiko: карточка складов", settings.text.includes("data-iiko-stores") && settings.text.includes("Склад кухни"), `HTTP ${settings.status}`);
}

writeFileSync(`${dir}/http-check.txt`, out.join("\n") + "\n");
const failed = out.filter((line) => line.startsWith("FAIL")).length;
console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
process.exit(failed === 0 ? 0 : 1);
