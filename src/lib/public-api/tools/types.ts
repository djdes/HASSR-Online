import { z } from "zod";
import type { ApiCallContext } from "../context";
import type { ApiKeyAccess } from "../keys";

/**
 * Инструмент публичного API: одно описание обслуживает и MCP
 * (`tools/list` / `tools/call`), и REST v1 (`rest.method` + `rest.path`),
 * и openapi.json.
 */

export type ToolResult =
  | { ok: true; data: Record<string, unknown>; text?: string }
  | { ok: false; status: 400 | 402 | 403 | 404 | 409 | 422 | 500; error: string };

export type ApiTool = {
  /** snake_case — имя инструмента MCP и operationId в OpenAPI. */
  name: string;
  /** Короткое человекочитаемое название. */
  title: string;
  /** Описание для модели: когда звать и что вернётся. */
  description: string;
  access: ApiKeyAccess;
  input: z.ZodObject;
  /** Путь относительно /api/v1; параметры пути — "{documentId}". */
  rest: { method: "GET" | "POST"; path: `/${string}` };
  // Вход уже провалидирован `input` в runTool.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(input: any, ctx: ApiCallContext): Promise<ToolResult>;
};

export function toolInputJsonSchema(tool: ApiTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function toolOk(data: Record<string, unknown>, text?: string): ToolResult {
  return text ? { ok: true, data, text } : { ok: true, data };
}

export function toolError(status: Exclude<ToolResult, { ok: true }>["status"], error: string): ToolResult {
  return { ok: false, status, error };
}
