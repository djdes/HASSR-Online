// Локальная заглушка Saby для e2e: вход по ключам приложения, «Наши организации»,
// «Информация о контрагенте», запись и чтение черновика. Живой Saby в тестах не вызывается.
// Формы ответов — как в DocsFlow (живой кабинет 23.10.2026) и в тесте magdv/sbis.
const http = require("http");

const GOOD_CLIENT = "e2e-client";
const GOOD_SECRET = "e2e-secret-value";

function createMockSaby(port) {
  const docs = new Map();
  const calls = [];
  let tokenSeq = 0;
  const liveTokens = new Set();

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
      };
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (url.pathname === "/__mock/state" && req.method === "POST") {
        const { code, name } = JSON.parse(body || "{}");
        for (const d of docs.values()) d.state = { Код: String(code), Название: name || `Состояние ${code}` };
        return send(200, { ok: true, count: docs.size });
      }
      if (url.pathname === "/__mock/calls") return send(200, { calls, docs: [...docs.values()] });
      if (url.pathname.startsWith("/page/doc/")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<html><body><h1>Saby mock: карточка документа</h1></body></html>");
      }

      if (url.pathname === "/oauth/service/") {
        const data = JSON.parse(body || "{}");
        if (data.event === "exit") {
          liveTokens.delete(data.token);
          calls.push({ method: "logout" });
          return send(200, {});
        }
        calls.push({ method: "login", clientId: data.app_client_id, secretOk: data.app_secret === GOOD_SECRET });
        if (data.app_client_id !== GOOD_CLIENT || data.app_secret !== GOOD_SECRET) {
          return send(400, { error: "Не удалось осуществить авторизацию. [0] (ОПИСАНИЕ: Приложение не найдено!)" });
        }
        tokenSeq++;
        const token = `tok-${tokenSeq}`;
        liveTokens.add(token);
        return send(200, { access_token: token, sid: `sid-${tokenSeq}`, token });
      }

      if (url.pathname === "/service/") {
        const token = req.headers["x-sbisaccesstoken"];
        const rpc = JSON.parse(body || "{}");
        const params = rpc.params || {};
        calls.push({ method: rpc.method, params: redact(params) });
        if (!liveTokens.has(token)) {
          return send(401, { jsonrpc: "2.0", error: { code: -32000, message: "Сессия не найдена" }, id: 0 });
        }
        const ok = (result) => send(200, { jsonrpc: "2.0", result, id: 0 });
        switch (rpc.method) {
          case "СБИС.СписокНашихОрганизаций":
            return ok({
              НашаОрганизация: [
                { СвЮЛ: { ИНН: "5018215599", КПП: "501801001", Название: "ООО \"БФС\"" }, ДокументооборотПодключен: "Да" },
                { СвФЛ: { ИНН: "500100732259", Фамилия: "Волков", Имя: "Олег", Отчество: "Игоревич" }, ДокументооборотПодключен: "Нет" },
              ],
            });
          case "СБИС.ИнформацияОКонтрагенте": {
            const ul = (params.Участник || {}).СвЮЛ || {};
            if (ul.ИНН === "7707083893") {
              return ok({
                Идентификатор: [
                  {
                    ИдентификаторУчастника: "2BM-7707083893-773601001-e2e",
                    Основной: "Да",
                    Роуминг: "Да",
                    Оператор: { Идентификатор: "2BM", Название: "АО «ПФ «СКБ Контур»" },
                    СостояниеПодключения: { Код: "1", Описание: "Подключен" },
                  },
                ],
                СвЮЛ: { ИНН: ul.ИНН, КПП: ul.КПП, Название: "ООО «Доброе кафе»" },
              });
            }
            return ok({ Идентификатор: "", СвЮЛ: ul });
          }
          case "СБИС.ЗаписатьДокумент": {
            const d = params.Документ;
            const existing = docs.get(d.Идентификатор);
            if (existing && existing.state.Код !== "0") {
              return send(200, { jsonrpc: "2.0", error: { code: -32000, message: "Документ уже отправлен" }, id: 0 });
            }
            docs.set(d.Идентификатор, {
              id: d.Идентификатор,
              type: d.Тип,
              number: d.Номер,
              date: d.Дата,
              ours: d.НашаОрганизация,
              contractor: d.Контрагент,
              files: (d.Вложение || []).map((a) => ({ id: a.Идентификатор, name: a.Файл.Имя, size: Buffer.from(a.Файл.ДвоичныеДанные, "base64").length })),
              writes: (existing ? existing.writes : 0) + 1,
              state: { Код: "0", Название: "Документ редактируется" },
            });
            // Как живой кабинет: запись ссылку не отдаёт — её берут из ПрочитатьДокумент.
            return ok({ Идентификатор: d.Идентификатор, Состояние: { Код: "0", Название: "Документ редактируется" } });
          }
          case "СБИС.ПрочитатьДокумент": {
            const id = (params.Документ || {}).Идентификатор;
            const d = docs.get(id);
            if (!d) return send(200, { jsonrpc: "2.0", error: { code: -32000, message: "Документ не найден", data: { classid: "{00000000-0000-0000-0000-1fa000010007}" } }, id: 0 });
            return ok({
              Идентификатор: d.id,
              Тип: d.type,
              Номер: d.number,
              Состояние: d.state,
              СсылкаДляНашаОрганизация: `http://127.0.0.1:${port}/page/doc/${d.id}`,
              Контрагент: { СвЮЛ: { ИНН: d.contractor?.СвЮЛ?.ИНН ?? "", Название: d.contractor?.СвЮЛ?.Название ?? "" } },
            });
          }
          default:
            return send(200, { jsonrpc: "2.0", error: { code: -32601, message: `Метод ${rpc.method} не найден` }, id: 0 });
        }
      }
      send(404, { error: "not found" });
    });
  });

  return {
    calls,
    docs,
    listen: () => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** В журнал вызовов файлы не кладём целиком. */
function redact(params) {
  return JSON.parse(
    JSON.stringify(params, (key, value) => (key === "ДвоичныеДанные" && typeof value === "string" ? `<${value.length} b64>` : value)),
  );
}

module.exports = { createMockSaby, GOOD_CLIENT, GOOD_SECRET };

if (require.main === module) {
  const port = Number(process.argv[2] || 4555);
  createMockSaby(port)
    .listen()
    .then(() => console.log(`mock saby on http://127.0.0.1:${port}`));
}
