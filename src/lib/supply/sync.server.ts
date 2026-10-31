import type { SabyAppSession } from "@/lib/edo/saby/rpc";
import { SabyRpcError, describeSabyError } from "@/lib/edo/saby/rpc";
import { createSabyCaller, type SabySessionStore } from "@/lib/edo/saby/session";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/integration-crypto";

import {
  diadocBaseUrl,
  readIikoOptions,
  syncFromDate,
  type DiadocStoredCredentials,
  type IikoStoredCredentials,
  type SabyStoredCredentials,
  type SupplyProvider,
} from "./connections";
import { createDiadocClient, DiadocError, type FetchLike } from "./diadoc";
import { saveSupplyDocument } from "./documents.server";
import { createIikoClient, IikoError } from "./iiko";
import { addMissingProducts } from "./products.server";
import { assertPublicServerUrl, UnsafeUrlError } from "./safe-url";
import { createSabyIncomingApi, isAllowedSabyFileUrl } from "./saby-incoming";
import { syncDiadocDocuments, syncIikoData, syncSabyDocuments, type SyncCounters, type SyncSink } from "./sync";

/**
 * Загрузка входящих УПД по подключениям организации: Диадок и СБИС. Ошибка
 * одного подключения не мешает другому и записывается в него (её видно в
 * настройках); ключи и токены в текст ошибки не попадают.
 */

export type ConnectionSyncResult = SyncCounters & {
  provider: SupplyProvider;
  ok: boolean;
  error: string | null;
  /** iiko: новые строки потерь и товары в справочнике. */
  losses?: number;
  products?: number;
};

const DOWNLOAD_TIMEOUT_MS = 30_000;

function sinkFor(organizationId: string, source: SupplyProvider): SyncSink {
  return {
    exists: async (externalId) =>
      (await db.supplyDocument.count({ where: { organizationId, source, externalId } })) > 0,
    save: ({ externalId, parsed, fileName }) =>
      saveSupplyDocument({ organizationId, source, externalId, parsed, fileName }),
  };
}

/** Причина, которую можно показать человеку как есть. */
class SupplySyncError extends Error {}

/** Понятная причина без секретов: свои ошибки — как есть, чужие — общими словами. */
function describe(error: unknown): string {
  if (error instanceof DiadocError || error instanceof IikoError || error instanceof UnsafeUrlError) return error.message;
  if (error instanceof SabyRpcError) return describeSabyError(error);
  if (error instanceof SupplySyncError) return error.message;
  return "Не удалось загрузить документы — повторим при следующей проверке";
}

function readSession(blob: string | null): SabyAppSession | null {
  if (!blob) return null;
  try {
    const value = JSON.parse(decryptSecret(blob)) as SabyAppSession;
    return value && typeof value.accessToken === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function syncSupplyConnection(
  connectionId: string,
  deps: { fetch?: FetchLike; now?: Date } = {},
): Promise<ConnectionSyncResult | null> {
  const connection = await db.supplyConnection.findUnique({ where: { id: connectionId } });
  if (!connection) return null;
  const provider = connection.provider as SupplyProvider;
  const now = deps.now ?? new Date();
  const fetchImpl: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const sink = sinkFor(connection.organizationId, provider);
  const fromDate = syncFromDate(connection.lastSyncAt, now);

  try {
    let counters: SyncCounters & { losses?: number; products?: number };
    if (provider === "iiko") {
      const creds = JSON.parse(decryptSecret(connection.credentialsEnc)) as IikoStoredCredentials;
      const serverUrl = await assertPublicServerUrl(creds.serverUrl);
      const organizationId = connection.organizationId;
      counters = await syncIikoData({
        client: createIikoClient({ ...creds, serverUrl }, { fetch: fetchImpl }),
        fromDate,
        toDate: now.toISOString().slice(0, 10),
        options: readIikoOptions(creds.options),
        sink,
        losses: {
          exists: async (sourceEntryId) => (await db.lossRecord.count({ where: { organizationId, sourceEntryId } })) > 0,
          save: async (loss) => {
            await db.lossRecord.create({
              data: {
                organizationId,
                date: new Date(`${loss.date}T12:00:00.000Z`),
                category: "writeoff",
                productName: loss.productName,
                quantity: loss.quantity,
                unit: loss.unit,
                costRub: loss.costRub,
                cause: loss.cause,
                sourceEntryId: loss.sourceEntryId,
              },
            });
          },
        },
        products: { addMissing: (items) => addMissingProducts(organizationId, items) },
      });
    } else if (provider === "diadoc") {
      const creds = JSON.parse(decryptSecret(connection.credentialsEnc)) as DiadocStoredCredentials;
      if (!connection.boxId) throw new SupplySyncError("Не выбран ящик Диадока — подключите заново");
      const client = createDiadocClient(creds, { fetch: fetchImpl, baseUrl: diadocBaseUrl() });
      counters = await syncDiadocDocuments({ client, boxId: connection.boxId, fromDate, sink });
    } else {
      const creds = JSON.parse(decryptSecret(connection.credentialsEnc)) as SabyStoredCredentials;
      let session = readSession(connection.sessionEnc);
      const store: SabySessionStore = {
        load: async () => session,
        save: async (next) => {
          session = next;
          await db.supplyConnection.update({
            where: { id: connection.id },
            data: { sessionEnc: encryptSecret(JSON.stringify(next)) },
          });
        },
        clear: async () => {
          session = null;
          await db.supplyConnection.update({ where: { id: connection.id }, data: { sessionEnc: null } });
        },
      };
      const call = createSabyCaller(creds, store, { fetchImpl, key: `supply:${connection.id}` });
      const download = async (url: string): Promise<Uint8Array> => {
        if (!isAllowedSabyFileUrl(url)) throw new SupplySyncError("СБИС прислал ссылку на файл не со своего адреса");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        try {
          const res = await fetchImpl(url, {
            method: "GET",
            headers: session ? { "X-SBISAccessToken": session.accessToken } : {},
            signal: controller.signal,
          });
          if (!res.ok) throw new SupplySyncError(`СБИС не отдал файл накладной (HTTP ${res.status})`);
          return new Uint8Array(await res.arrayBuffer());
        } finally {
          clearTimeout(timer);
        }
      };
      counters = await syncSabyDocuments({
        api: createSabyIncomingApi(call),
        download,
        fromDate,
        toDate: now.toISOString().slice(0, 10),
        sink,
      });
    }
    await db.supplyConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: now, status: "active", lastError: null },
    });
    return { provider, ok: true, error: null, ...counters };
  } catch (error) {
    const message = describe(error);
    console.error(`[supply] sync failed provider=${provider} connection=${connection.id}`, error instanceof Error ? error.name : "error");
    await db.supplyConnection.update({
      where: { id: connection.id },
      data: { status: "error", lastError: message },
    });
    return { provider, ok: false, error: message, created: 0, skipped: 0, failed: 0 };
  }
}

/**
 * Все подключения организации. `minIntervalMs` — не чаще: при открытии
 * входящих проверяем, только если с прошлого раза прошло 15 минут.
 */
export async function syncOrganizationSupply(
  organizationId: string,
  options: { minIntervalMs?: number; now?: Date } = {},
): Promise<ConnectionSyncResult[]> {
  const now = options.now ?? new Date();
  const connections = await db.supplyConnection.findMany({
    where: { organizationId },
    select: { id: true, lastSyncAt: true },
  });
  const results: ConnectionSyncResult[] = [];
  for (const connection of connections) {
    if (
      options.minIntervalMs &&
      connection.lastSyncAt &&
      now.getTime() - connection.lastSyncAt.getTime() < options.minIntervalMs
    ) {
      continue;
    }
    const result = await syncSupplyConnection(connection.id, { now });
    if (result) results.push(result);
  }
  return results;
}
