import { CLIMATE_DOCUMENT_TEMPLATE_CODE, normalizeClimateDocumentConfig } from "@/lib/climate-document";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE, normalizeColdEquipmentDocumentConfig } from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import { isJournalObjectQrCode } from "@/lib/journal-qr-target";
import { isUvLampType } from "@/lib/uv-lamp";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE, normalizeUvRuntimeDocumentConfig } from "@/lib/uv-lamp-runtime-document";

/**
 * Чьи наклейки печатать по кнопке «QR-точка контроля» журнала объектов
 * (server-only). Журнал сам по себе не сканируют — сканируют холодильник,
 * склад или лампу, — поэтому область журнала = его объекты:
 *   • документ (`doc=`) — объекты его строк;
 *   • иначе объекты активных сегодня документов журнала;
 *   • нет активных (первый день нового периода) — последнего документа;
 *   • журналом ещё не пользовались — подходящие объекты справочника
 *     (холодильное оборудование с нормой, все помещения, все УФ-лампы).
 */
export type JournalObjectScope = {
  code: string;
  kind: "equipment" | "room";
  journalName: string;
  /** Документ, если область — его строки. */
  document: { id: string; title: string } | null;
  /** id оборудования или помещений справочника. */
  ids: string[];
  source: "document" | "active" | "latest" | "directory";
};

type ScopeDoc = { id: string; title: string; config: unknown };

function idsFromConfig(code: string, config: unknown): string[] {
  if (code === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    return normalizeColdEquipmentDocumentConfig(config)
      .equipment.map((item) => item.sourceEquipmentId)
      .filter((id): id is string => Boolean(id));
  }
  if (code === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    return normalizeClimateDocumentConfig(config)
      .rooms.map((room) => room.roomId)
      .filter((id): id is string => Boolean(id));
  }
  if (code === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    const equipmentId = normalizeUvRuntimeDocumentConfig(config).equipmentId;
    return equipmentId ? [equipmentId] : [];
  }
  return [];
}

async function directoryIds(organizationId: string, code: string): Promise<string[]> {
  if (code === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    const rooms = await db.room.findMany({ where: { building: { organizationId } }, select: { id: true } });
    return rooms.map((room) => room.id);
  }
  const equipment = await db.equipment.findMany({
    where: { area: { organizationId } },
    select: { id: true, type: true, tempMin: true, tempMax: true },
  });
  if (code === UV_LAMP_RUNTIME_TEMPLATE_CODE) return equipment.filter((item) => isUvLampType(item.type)).map((item) => item.id);
  // Как `buildColdEquipmentConfigFromEquipment`: холодильник/морозильник или норма температуры.
  return equipment
    .filter((item) => {
      if (isUvLampType(item.type)) return false;
      const type = item.type?.toLowerCase();
      return type === "refrigerator" || type === "freezer" || item.tempMin != null || item.tempMax != null;
    })
    .map((item) => item.id);
}

const unique = (ids: string[]) => Array.from(new Set(ids));

export async function resolveJournalObjectScope(
  organizationId: string,
  code: string,
  todayKey: string,
  documentId?: string | null
): Promise<JournalObjectScope | null> {
  if (!isJournalObjectQrCode(code)) return null;
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, name: true } });
  if (!template) return null;
  const kind = code === CLIMATE_DOCUMENT_TEMPLATE_CODE ? "room" : "equipment";
  const base = { code, kind, journalName: template.name } as const;
  const select = { id: true, title: true, config: true } as const;

  if (documentId) {
    const document: ScopeDoc | null = await db.journalDocument.findFirst({
      where: { id: documentId, organizationId, templateId: template.id },
      select,
    });
    const ids = document ? unique(idsFromConfig(code, document.config)) : [];
    // Документ УФ без связанной лампы — область журнала целиком (ниже).
    if (document && (ids.length > 0 || code !== UV_LAMP_RUNTIME_TEMPLATE_CODE)) {
      return { ...base, document: { id: document.id, title: document.title }, ids, source: "document" };
    }
  }

  if (code === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    // У каждой лампы свой документ; наклейки нужны всем лампам «Оборудования».
    return { ...base, document: null, ids: await directoryIds(organizationId, code), source: "directory" };
  }

  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const active: ScopeDoc[] = await db.journalDocument.findMany({
    where: { organizationId, templateId: template.id, status: "active", dateFrom: { lte: day }, dateTo: { gte: day } },
    select,
  });
  const activeIds = unique(active.flatMap((doc) => idsFromConfig(code, doc.config)));
  if (activeIds.length > 0) return { ...base, document: null, ids: activeIds, source: "active" };

  const latest: ScopeDoc | null = await db.journalDocument.findFirst({
    where: { organizationId, templateId: template.id },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    select,
  });
  const latestIds = latest ? unique(idsFromConfig(code, latest.config)) : [];
  if (latestIds.length > 0) return { ...base, document: null, ids: latestIds, source: "latest" };

  return { ...base, document: null, ids: await directoryIds(organizationId, code), source: "directory" };
}
