import type { ApiTool } from "../tools/types";

export type RestMatch =
  | { kind: "tool"; tool: ApiTool; params: Record<string, string> }
  | { kind: "method_not_allowed"; allow: string[] }
  | { kind: "not_found" };

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const segment = segments[i];
    if (!segment) return null;
    const param = /^\{(\w+)\}$/.exec(part);
    if (param) params[param[1]] = segment;
    else if (part !== segment) return null;
  }
  return params;
}

/** Метод + путь `/api/v1/<segments>` → инструмент реестра. */
export function matchRestRoute(method: string, segments: string[], tools: readonly ApiTool[]): RestMatch {
  const allow: string[] = [];
  for (const tool of tools) {
    const params = matchPath(tool.rest.path, segments);
    if (!params) continue;
    if (tool.rest.method === method.toUpperCase()) return { kind: "tool", tool, params };
    allow.push(tool.rest.method);
  }
  return allow.length ? { kind: "method_not_allowed", allow: [...new Set(allow)].sort() } : { kind: "not_found" };
}
