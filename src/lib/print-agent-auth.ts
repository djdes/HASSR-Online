import crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Токены программы «Онлайн принтер».
 *
 * Токен — единственное, что агент хранит на диске машины у принтера.
 * Пароль пользователя туда не попадает: он вводится один раз при
 * подключении, живёт только в памяти процесса и в одном HTTPS-запросе.
 * Это и есть автологин из задачи — после перезагрузки агент продолжает
 * работать по токену, ничего не спрашивая.
 *
 * Храним только sha256 (как `InspectorToken`): утечка дампа БД не даёт
 * рабочих токенов. bcrypt не нужен — 32 случайных байта перебирать нечем.
 */

/** Сколько агент считается онлайн после последнего опроса. */
export const AGENT_ONLINE_WINDOW_MS = 90 * 1000;

/**
 * Реже писать `lastSeenAt` нельзя, чаще — незачем: агент опрашивает
 * сервер каждые 5 секунд, и запись в БД на каждый опрос — это 17 тысяч
 * лишних UPDATE в сутки на одну кассу.
 */
export const AGENT_HEARTBEAT_THROTTLE_MS = 30 * 1000;

/**
 * Онлайн ли агент. Отдельная функция, а не выражение в компоненте:
 * `Date.now()` прямо в рендере — нечистый вызов, он расходится между
 * серверным рендером и гидратацией.
 */
export function isAgentOnline(lastSeenAt: Date | null | undefined): boolean {
  return Boolean(
    lastSeenAt && Date.now() - lastSeenAt.getTime() < AGENT_ONLINE_WINDOW_MS,
  );
}

export function generateAgentToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashAgentToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Достаёт Bearer-токен. Query-строку не поддерживаем: она целиком уходит в логи nginx. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export type AuthedAgent = {
  id: string;
  organizationId: string;
  /** Точка принтера (2026-11-01); null — вся организация. */
  buildingId: string | null;
  name: string;
  printerName: string | null;
};

/**
 * Находит агента по токену из заголовка. Отозванный агент не проходит:
 * строка остаётся ради истории печати, но работать перестаёт.
 *
 * Организацию берём ИЗ СТРОКИ АГЕНТА, а не из запроса — клиент её не
 * передаёт вообще. Так задание одной организации физически не может
 * уехать на принтер другой (П-18).
 */
export async function authenticateAgent(
  request: Request,
): Promise<AuthedAgent | null> {
  const raw = readBearerToken(request);
  if (!raw) return null;

  const agent = await db.printAgent.findUnique({
    where: { tokenHash: hashAgentToken(raw) },
    select: {
      id: true,
      organizationId: true,
      buildingId: true,
      name: true,
      printerName: true,
      revokedAt: true,
    },
  });
  if (!agent || agent.revokedAt) return null;

  return {
    id: agent.id,
    organizationId: agent.organizationId,
    buildingId: agent.buildingId,
    name: agent.name,
    printerName: agent.printerName,
  };
}

/** Отметка «агент на связи», с троттлингом. */
export async function touchAgent(
  agentId: string,
  lastSeenAt: Date | null,
  patch: { printerName?: string | null; printers?: string[]; agentVersion?: string } = {},
): Promise<void> {
  const stale =
    !lastSeenAt ||
    Date.now() - lastSeenAt.getTime() > AGENT_HEARTBEAT_THROTTLE_MS;
  const hasPatch = Object.keys(patch).length > 0;
  if (!stale && !hasPatch) return;

  await db.printAgent.update({
    where: { id: agentId },
    data: {
      lastSeenAt: new Date(),
      ...(patch.printerName !== undefined
        ? { printerName: patch.printerName }
        : {}),
      ...(patch.printers ? { printers: patch.printers } : {}),
      ...(patch.agentVersion ? { agentVersion: patch.agentVersion } : {}),
    },
  });
}
