import { db } from "@/lib/db";
import type { EntryWriteActor } from "@/lib/journal-entry-write";
import type { ApiCallContext, ApiVia } from "./context";
import type { ApiTool, ToolResult } from "./tools/types";

export type AuditWriter = (entry: {
  orgId: string;
  actor: EntryWriteActor;
  tool: string;
  via: ApiVia;
  keyId: string;
  keyName: string;
  input: unknown;
}) => Promise<void>;

const writeAuditToDb: AuditWriter = async (entry) => {
  await db.auditLog
    .create({
      data: {
        organizationId: entry.orgId,
        userId: entry.actor.id,
        userName: entry.actor.name,
        action: "public_api.call",
        entity: entry.tool,
        details: {
          tool: entry.tool,
          via: entry.via,
          keyId: entry.keyId,
          keyName: entry.keyName,
          input: JSON.parse(JSON.stringify(entry.input ?? {})),
        },
      },
    })
    .catch((error) => console.error("[public-api] audit log failed", error));
};

/**
 * Единая точка вызова инструмента для MCP и REST: права ключа, разбор
 * входа, обработчик и аудит записи. Чтение в аудит не пишем — его слишком
 * много, а след оставляет `ApiAccessKey.lastUsedAt`.
 */
export async function runTool(
  tool: ApiTool,
  rawInput: unknown,
  ctx: ApiCallContext,
  writeAudit: AuditWriter = writeAuditToDb
): Promise<ToolResult> {
  if (tool.access === "write" && ctx.access !== "write") {
    return {
      ok: false,
      status: 403,
      error: "Ключ только для чтения: создайте ключ «Чтение и запись», чтобы ИИ мог записывать.",
    };
  }
  const raw = rawInput ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 422, error: "Аргументы должны быть объектом." };
  }
  const parsed = tool.input.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "(аргументы)";
    return { ok: false, status: 422, error: `Неверные аргументы: ${path}: ${issue?.message ?? "ошибка"}` };
  }

  let result: ToolResult;
  try {
    result = await tool.handler(parsed.data, ctx);
  } catch (error) {
    console.error(`[public-api] tool ${tool.name} failed`, error);
    return { ok: false, status: 500, error: "Внутренняя ошибка WeSetup — попробуйте ещё раз." };
  }

  if (result.ok && tool.access === "write") {
    await writeAudit({
      orgId: ctx.orgId,
      actor: ctx.actor,
      tool: tool.name,
      via: ctx.via,
      keyId: ctx.keyId,
      keyName: ctx.keyName,
      input: parsed.data,
    });
  }
  return result;
}
