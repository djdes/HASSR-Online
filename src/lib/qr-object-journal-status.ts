import { CLIMATE_DOCUMENT_TEMPLATE_CODE, normalizeClimateDocumentConfig, type ClimateMeasurement } from "@/lib/climate-document";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE, normalizeColdEquipmentDocumentConfig, normalizeColdEquipmentEntryData } from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import { esc } from "@/lib/journal-fill-html";
import { resolveJournalObjectScope } from "@/lib/qr-journal-scope";
import { orgDayStartInstant } from "@/lib/timezone";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";

/**
 * Основной QR журнала объектов (холодильники, склады, УФ-лампы) —
 * 2026-09-23. Заполнять объекты из списка нельзя (решение `33d8559b`:
 * человек должен стоять у самого холодильника), поэтому экран — только
 * статус за сегодня и «отсканируйте наклейку на самом …».
 *
 * ВАЖНО: ни токенов, ни ссылок на `/equipment-fill` и `/room-fill` здесь
 * нет и быть не должно. Списки из `qr-fill-siblings.ts` не используем —
 * они минтят рабочие ссылки и вернули бы заполнение «с дивана».
 *
 * Объектов нет — называем ответственного за журнал и даём кнопку входа
 * в настройки, где объекты заводят.
 */

export type ObjectStatusItem = {
  id: string;
  name: string;
  /** «done» — сегодня отмечено, «todo» — ещё нет. */
  state: "done" | "todo";
  /** Короткая сводка: «+3 °C», «включена с 09:10», «ещё нет замера». */
  summary: string;
};

export type ObjectStatusGroup = { name: string; items: ObjectStatusItem[] };

type Copy = {
  noun: string;
  scanHint: string;
  emptyTitle: string;
  emptyAction: string;
  settingsPath: string;
  buttonLabel: string;
  doneLabel: string;
};

const COPY: Record<string, Copy> = {
  [COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE]: {
    noun: "холодильник",
    scanHint: "Отсканируйте наклейку на самом холодильнике — откроется именно он, и температура ляжет в его строку.",
    emptyTitle: "Холодильники ещё не добавлены",
    emptyAction: "должен войти и добавить оборудование",
    settingsPath: "/settings/equipment",
    buttonLabel: "Войти и добавить оборудование",
    doneLabel: "замер снят",
  },
  [CLIMATE_DOCUMENT_TEMPLATE_CODE]: {
    noun: "помещение",
    scanHint: "Отсканируйте наклейку в самом помещении — откроется именно оно, и замер ляжет в его строку.",
    emptyTitle: "Помещения ещё не добавлены",
    emptyAction: "должен войти и добавить помещения",
    settingsPath: "/settings/buildings",
    buttonLabel: "Войти и добавить помещения",
    doneLabel: "замер снят",
  },
  [UV_LAMP_RUNTIME_TEMPLATE_CODE]: {
    noun: "лампа",
    scanHint: "Отсканируйте наклейку на самой УФ-лампе — откроется именно она: «Я включил» и «Я выключил».",
    emptyTitle: "УФ-лампы ещё не добавлены",
    emptyAction: "должен войти и добавить оборудование",
    settingsPath: "/settings/equipment",
    buttonLabel: "Войти и добавить оборудование",
    doneLabel: "сегодня включали",
  },
};

export function objectJournalCopy(code: string): Copy {
  return COPY[code] ?? COPY[COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE];
}

/** Куда ведёт кнопка «Войти и добавить…» (после входа — в настройки объектов). */
export function objectJournalSetupHref(code: string): string {
  return `/login?next=${objectJournalCopy(code).settingsPath}`;
}

function formatNumber(value: number, unit: string): string {
  const sign = value > 0 && unit === "°C" ? "+" : "";
  return `${sign}${value} ${unit}`;
}

function groupBy(items: Array<ObjectStatusItem & { group: string }>): ObjectStatusGroup[] {
  const groups = new Map<string, ObjectStatusItem[]>();
  for (const { group, ...item } of items) {
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }
  return Array.from(groups.entries()).map(([name, list]) => ({ name, items: list }));
}

function hhmm(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at).replace(/^24/, "00");
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** Объекты журнала со статусом за сегодня, по точкам (помещения) или цехам (оборудование). */
export async function loadObjectJournalStatus(params: {
  organizationId: string;
  code: string;
  todayKey: string;
  timezone: string;
  documentId?: string | null;
}): Promise<ObjectStatusGroup[]> {
  const { organizationId, code, todayKey } = params;
  const scope = await resolveJournalObjectScope(organizationId, code, todayKey, params.documentId ?? null);
  if (!scope || scope.ids.length === 0) return [];
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const activeDocs = await db.journalDocument.findMany({
    where: { organizationId, status: "active", template: { code }, dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { id: true, config: true },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
  });
  const entries =
    activeDocs.length > 0 && code !== UV_LAMP_RUNTIME_TEMPLATE_CODE
      ? await db.journalDocumentEntry.findMany({ where: { documentId: { in: activeDocs.map((doc) => doc.id) }, date: day }, select: { documentId: true, data: true } })
      : [];

  if (code === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    const rooms = await db.room.findMany({
      where: { id: { in: scope.ids }, building: { organizationId } },
      select: { id: true, name: true, building: { select: { name: true } } },
      orderBy: [{ building: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    });
    const lastMeasurement = (roomId: string): ClimateMeasurement | null => {
      let found: ClimateMeasurement | null = null;
      for (const doc of activeDocs) {
        const row = normalizeClimateDocumentConfig(doc.config).rooms.find((room) => room.roomId === roomId);
        if (!row) continue;
        for (const entry of entries) {
          if (entry.documentId !== doc.id) continue;
          const data = entry.data && typeof entry.data === "object" ? (entry.data as { measurements?: Record<string, Record<string, ClimateMeasurement>> }) : null;
          for (const cell of Object.values(data?.measurements?.[row.id] ?? {})) {
            if (cell && (typeof cell.temperature === "number" || typeof cell.humidity === "number")) found = cell;
          }
        }
      }
      return found;
    };
    return groupBy(
      rooms.map((room) => {
        const cell = lastMeasurement(room.id);
        const parts = cell
          ? [typeof cell.temperature === "number" ? formatNumber(cell.temperature, "°C") : null, typeof cell.humidity === "number" ? formatNumber(cell.humidity, "%") : null].filter(Boolean)
          : [];
        return {
          id: room.id,
          name: room.name,
          group: room.building.name,
          state: cell ? "done" : "todo",
          summary: cell ? `замер снят: ${parts.join(" · ")}` : "сегодня замера ещё нет",
        };
      })
    );
  }

  const equipment = await db.equipment.findMany({
    where: { id: { in: scope.ids }, area: { organizationId } },
    select: { id: true, name: true, runningSince: true, area: { select: { name: true } } },
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
  });

  if (code === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    const sessions = await db.equipmentRunSession.groupBy({
      by: ["equipmentId"],
      where: { organizationId, equipmentId: { in: equipment.map((item) => item.id) }, startedAt: { gte: orgDayStartInstant(params.timezone) } },
      _count: { _all: true },
    });
    return groupBy(
      equipment.map((lamp) => {
        const today = sessions.find((row) => row.equipmentId === lamp.id)?._count._all ?? 0;
        const running = lamp.runningSince ? `включена с ${hhmm(params.timezone, lamp.runningSince)}` : null;
        return {
          id: lamp.id,
          name: lamp.name,
          group: lamp.area.name,
          state: running || today > 0 ? "done" : "todo",
          summary: running ?? (today > 0 ? "сегодня включали" : "сегодня не включали"),
        };
      })
    );
  }

  // Холодильники: последнее показание за сегодня по любому активному документу.
  const lastTemperature = (equipmentId: string): number | null => {
    let found: number | null = null;
    for (const doc of activeDocs) {
      const items = normalizeColdEquipmentDocumentConfig(doc.config).equipment.filter((item) => item.sourceEquipmentId === equipmentId);
      for (const item of items) {
        for (const entry of entries) {
          if (entry.documentId !== doc.id) continue;
          const temperatures = normalizeColdEquipmentEntryData(entry.data ?? null).temperatures;
          for (const [key, value] of Object.entries(temperatures)) {
            if ((key === item.id || key.startsWith(`${item.id}#`)) && typeof value === "number") found = value;
          }
        }
      }
    }
    return found;
  };
  return groupBy(
    equipment.map((item) => {
      const temperature = lastTemperature(item.id);
      return {
        id: item.id,
        name: item.name,
        group: item.area.name,
        state: temperature !== null ? "done" : "todo",
        summary: temperature !== null ? `замер снят: ${formatNumber(temperature, "°C")}` : "сегодня замера ещё нет",
      };
    })
  );
}

const CHECK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>`;

/**
 * Тело экрана (чистая функция). Только текст — ни одной ссылки на
 * заполнение; единственная ссылка — вход в настройки, когда объектов нет.
 */
export function renderObjectJournalStatus(params: { code: string; groups: ObjectStatusGroup[]; responsible: string }): string {
  const copy = objectJournalCopy(params.code);
  const total = params.groups.reduce((sum, group) => sum + group.items.length, 0);
  if (total === 0) {
    return `<div class="card center os-empty">
<h2>${esc(copy.emptyTitle)}</h2>
<p class="muted">Ответственный за журнал — ${esc(params.responsible)} — ${esc(copy.emptyAction)}. Затем на каждый объект печатается своя наклейка с QR-кодом — её и сканируют.</p>
<a class="btn" href="${esc(objectJournalSetupHref(params.code))}">${esc(copy.buttonLabel)}</a>
</div>`;
  }
  const done = params.groups.reduce((sum, group) => sum + group.items.filter((item) => item.state === "done").length, 0);
  const groups = params.groups
    .map(
      (group) => `<p class="bk-sub">${esc(group.name)}</p><ul class="os-list">${group.items
        .map(
          (item) =>
            `<li class="os-i${item.state === "done" ? " done" : ""}"><span class="os-n">${esc(item.name)}<small>${esc(item.summary)}</small></span>${
              item.state === "done" ? `<span class="os-s" aria-label="${esc(copy.doneLabel)}">${CHECK}</span>` : `<span class="os-s todo" aria-label="ещё нет">—</span>`
            }</li>`
        )
        .join("")}</ul>`
    )
    .join("");
  return `<div class="note">${esc(copy.scanHint)}</div>
<div class="card"><p class="label">Сегодня: ${done} из ${total}</p>${groups}
<p class="muted os-foot">Здесь только статус. Заполнить можно у самого объекта — по его наклейке.</p></div>`;
}
