import { readFileSync } from "node:fs";

/**
 * Режим проверки без очереди — только вне продакшена.
 *
 * `WESETUP_VISION_MOCK_REPLY` в окружении копии (dev/e2e) — готовый «ответ
 * воркера»: либо сырой текст (как вернула бы модель), либо JSON-объект по
 * видам `{"menu": "...", "raw": "...", "generic": "...", "label": "...",
 * "default": "..."}`. Вместо переменной можно указать файл с тем же
 * содержимым: `WESETUP_VISION_MOCK_FILE`. Особые значения: `__timeout__` —
 * «не успели», `__failed__` — «исполнитель не справился».
 * `WESETUP_VISION_MOCK_DELAY_MS` — пауза перед ответом (до 60 с), чтобы
 * увидеть «Распознаём…».
 *
 * На проде (`NODE_ENV=production`) переменные игнорируются: задания всегда
 * уходят в настоящую очередь.
 */

export type VisionMock =
  | { outcome: "reply"; text: string; delayMs: number }
  | { outcome: "timeout" | "failed"; delayMs: number };

const KEYED = ["menu", "raw", "generic", "label", "default"];

function readMockFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function resolveVisionMock(
  env: Record<string, string | undefined>,
  key: string,
  readFile: (path: string) => string | null = readMockFile
): VisionMock | null {
  if (env.NODE_ENV === "production") return null;
  const raw = env.WESETUP_VISION_MOCK_REPLY || (env.WESETUP_VISION_MOCK_FILE ? readFile(env.WESETUP_VISION_MOCK_FILE) : null);
  if (!raw || !raw.trim()) return null;
  const delay = Number(env.WESETUP_VISION_MOCK_DELAY_MS ?? 0);
  const delayMs = Number.isFinite(delay) ? Math.min(Math.max(Math.round(delay), 0), 60_000) : 0;

  let text = raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && KEYED.some((k) => k in parsed)) {
      const map = parsed as Record<string, unknown>;
      const value = map[key] ?? map.default;
      if (value === undefined) return null;
      text = typeof value === "string" ? value : JSON.stringify(value);
    }
  } catch {
    /* сырой текст ответа */
  }
  if (text.trim() === "__timeout__") return { outcome: "timeout", delayMs };
  if (text.trim() === "__failed__") return { outcome: "failed", delayMs };
  return { outcome: "reply", text, delayMs };
}
