import type { ApiKeyAccess } from "../keys";
import { getContextTool } from "./context-tools";
import { fillJournalCellsTool, getJournalDocumentTool, listJournalsTool } from "./journal-tools";
import { addEmployeeTool, listEmployeesTool } from "./staff-tools";
import type { ApiTool } from "./types";

/**
 * Реестр инструментов публичного API. Порядок фиксирован: MCP-клиенты
 * кэшируют список, а модель видит инструменты в этом порядке.
 */
export const PUBLIC_API_TOOLS: readonly ApiTool[] = [
  getContextTool,
  listJournalsTool,
  getJournalDocumentTool,
  fillJournalCellsTool,
  listEmployeesTool,
  addEmployeeTool,
];

export function findTool(name: string): ApiTool | undefined {
  return PUBLIC_API_TOOLS.find((tool) => tool.name === name);
}

export function toolsForAccess(access: ApiKeyAccess): ApiTool[] {
  return PUBLIC_API_TOOLS.filter((tool) => access === "write" || tool.access === "read");
}
