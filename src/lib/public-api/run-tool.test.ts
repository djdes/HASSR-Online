import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { ApiCallContext } from "./context";
import { runTool, type AuditWriter } from "./run-tool";
import type { ApiTool } from "./tools/types";

function ctx(access: "read" | "write" = "write"): ApiCallContext {
  return {
    keyId: "key1",
    keyName: "Мой ассистент",
    access,
    via: "mcp",
    orgId: "org1",
    orgName: "Кафе",
    timezone: "Europe/Moscow",
    actor: { id: "u1", role: "manager", isRoot: false, name: "Анна" },
    locale: "ru",
    baseUrl: "https://wesetup.ru",
  };
}

function fakeTool(
  access: "read" | "write",
  handler: ApiTool["handler"],
  input: z.ZodObject = z.object({ name: z.string().optional() })
): ApiTool & { calls: number } {
  const tool = {
    name: access === "write" ? "do_write" : "do_read",
    title: "Тест",
    description: "Тест",
    access,
    input,
    rest: { method: access === "write" ? "POST" : "GET", path: "/test" },
    calls: 0,
    async handler(this: void, i: unknown, c: ApiCallContext) {
      tool.calls += 1;
      return handler(i, c);
    },
  } as ApiTool & { calls: number };
  return tool;
}

function recorder() {
  const entries: Parameters<AuditWriter>[0][] = [];
  const writer: AuditWriter = async (entry) => {
    entries.push(entry);
  };
  return { entries, writer };
}

test("ключ «только чтение» → 403 на инструмент записи, обработчик не вызван", async () => {
  const tool = fakeTool("write", async () => ({ ok: true, data: {} }));
  const res = await runTool(tool, {}, ctx("read"), recorder().writer);
  assert.equal(res.ok ? 200 : res.status, 403);
  assert.match(res.ok ? "" : res.error, /только для чтения/);
  assert.equal(tool.calls, 0);
});

test("неверный вход → 422, в тексте путь поля", async () => {
  const tool = fakeTool("read", async () => ({ ok: true, data: {} }), z.object({ date: z.string().min(10) }));
  const res = await runTool(tool, { date: 5 }, ctx(), recorder().writer);
  assert.equal(res.ok ? 200 : res.status, 422);
  assert.match(res.ok ? "" : res.error, /date/);
});

test("аргументы null → как {}; строка → 422 «Аргументы должны быть объектом.»", async () => {
  const tool = fakeTool("read", async () => ({ ok: true, data: { fine: true } }));
  const asNull = await runTool(tool, null, ctx(), recorder().writer);
  assert.equal(asNull.ok, true);
  const asString = await runTool(tool, "hi", ctx(), recorder().writer);
  assert.deepEqual(asString, { ok: false, status: 422, error: "Аргументы должны быть объектом." });
});

test("успешная запись → writeAudit вызван один раз с { tool, via, keyId, keyName, input }", async () => {
  const tool = fakeTool("write", async () => ({ ok: true, data: { done: true } }));
  const rec = recorder();
  const res = await runTool(tool, { name: "Иван" }, ctx(), rec.writer);
  assert.equal(res.ok, true);
  assert.equal(rec.entries.length, 1);
  assert.deepEqual(
    { tool: rec.entries[0].tool, via: rec.entries[0].via, keyId: rec.entries[0].keyId, keyName: rec.entries[0].keyName, input: rec.entries[0].input },
    { tool: "do_write", via: "mcp", keyId: "key1", keyName: "Мой ассистент", input: { name: "Иван" } }
  );
});

test("успешное чтение и неудачная запись → writeAudit не вызван", async () => {
  const rec = recorder();
  await runTool(fakeTool("read", async () => ({ ok: true, data: {} })), {}, ctx(), rec.writer);
  await runTool(fakeTool("write", async () => ({ ok: false, status: 422, error: "нет" })), {}, ctx(), rec.writer);
  assert.equal(rec.entries.length, 0);
});

test("исключение в обработчике → 500 без стека в тексте", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const tool = fakeTool("read", async () => {
      throw new Error("boom at secret.ts:42");
    });
    const res = await runTool(tool, {}, ctx(), recorder().writer);
    assert.deepEqual(res, { ok: false, status: 500, error: "Внутренняя ошибка WeSetup — попробуйте ещё раз." });
  } finally {
    console.error = original;
  }
});
