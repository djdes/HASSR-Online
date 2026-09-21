import { formatTimesRu } from "@/lib/plural-ru";
import { getUserDisplayTitle, pickPrimaryManager } from "@/lib/user-roles";

export const CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE =
  "cleaning_ventilation_checklist";

export const CLEANING_VENTILATION_CHECKLIST_TITLE =
  "Чек-лист уборки и проветривания помещений";

export type CleaningVentilationResponsible = {
  id: string;
  title: string;
  userId: string;
};

export type CleaningVentilationProcedureConfig = {
  id: "disinfection" | "ventilation" | "wet_cleaning";
  label: string;
  enabled: boolean;
  times: string[];
  responsibleUserId: string;
};

export type CleaningVentilationChecklistConfig = {
  autoFillEnabled: boolean;
  skipWeekends: boolean;
  mainResponsibleTitle: string;
  mainResponsibleUserId: string;
  ventilationEnabled: boolean;
  customDates: string[];
  hiddenDates: string[];
  responsibles: CleaningVentilationResponsible[];
  procedures: CleaningVentilationProcedureConfig[];
  /**
   * Дополнительные строки блока «Периодичность» внутри таблицы. Базовые
   * строки считаются от процедур (`getCleaningVentilationPeriodicityLines`),
   * а сюда управляющая дописывает свои — кнопкой-ячейкой «+ Добавить
   * периодичность» на эталоне (cleaning_ventilation_checklist-grid.png).
   *
   * Опционально в типе: конфиги, собранные вне normalize (TF-адаптер), не
   * знают о поле — normalize всегда возвращает массив, читатели берут `?? []`.
   */
  extraPeriodicityLines?: string[];
};

export type CleaningVentilationChecklistEntryData = {
  procedures: Partial<Record<CleaningVentilationProcedureConfig["id"], string[]>>;
  responsibleUserId?: string;
};

type BasicUser = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike) — подпись ответственных.
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

function createId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_DESCRIPTION = [
  {
    label: "Обрабатываемые поверхности при дезинфекции",
    text: "дверные ручки, выключатели, стены, поверхности столов, спинки стульев, меню, кассовый аппарат, орг.техника",
  },
  {
    label: "Рабочие помещения при проветривании",
    text: "производственный цех",
  },
  {
    label: "Помещения, подлежащие влажной уборке",
    text: "заготовочный цех, мясной цех, холодный цех, горячий цех, обеденный зал, бар",
  },
  {
    label: "Используемое дез. средство, концентрация",
    text: "Ph Средство дезинфицирующее - 0,5%",
  },
];

export function getCleaningVentilationDescriptionLines() {
  return DEFAULT_DESCRIPTION.map((item) => ({ ...item }));
}

/**
 * V10 аудита: было «3 раз(а) в день» — несогласованное числительное.
 * Теперь числительное склоняется (`1 раз`, `2-4 раза`, `5+ раз`).
 */
export function getCleaningVentilationPeriodicityLines(enabledVentilation: boolean) {
  return [
    `Дезинфекция – ${formatTimesRu(3)} в день`,
    ...(enabledVentilation ? [`Проветривание – ${formatTimesRu(3)} в день`] : []),
    `Влажная уборка – ${formatTimesRu(2)} в день`,
  ];
}

// Канонические management-роли + legacy-наследие. После миграции
// схемы новые орги создаются с manager/head_chef, старые могут иметь
// owner/technologist. Раньше логика знала только legacy → новые
// орги получали fallback "Сотрудник" и пустой список responsibles.
const MANAGEMENT_ROLE_SET = new Set([
  "manager",
  "head_chef",
  "owner",
  "technologist",
]);

export function getRoleLabel(role: string) {
  if (MANAGEMENT_ROLE_SET.has(role)) {
    return "Управляющий";
  }
  return "Сотрудник";
}

export function getPreferredResponsibleUserId(users: BasicUser[]) {
  // Руководство (новые и старые роли), иначе любой сотрудник — но не
  // аккаунт-заглушка «имя = почта», пока в организации есть живые люди.
  return pickPrimaryManager(users)?.id || "";
}

export function getDefaultCleaningVentilationConfig(
  users: BasicUser[] = []
): CleaningVentilationChecklistConfig {
  const mainResponsibleUserId = getPreferredResponsibleUserId(users);
  // Должность самого ответственного из справочника; «Управляющий» — только
  // если в организации ещё никого нет.
  const mainResponsibleUser = users.find((user) => user.id === mainResponsibleUserId);
  const fallbackTitle = mainResponsibleUser
    ? getUserDisplayTitle(mainResponsibleUser)
    : getRoleLabel("owner");

  // Берём management-юзеров (новых и legacy) для default responsibles.
  // Раньше: только legacy ["owner", "technologist", "operator"] —
  // в новых органзациях с manager/head_chef возвращался пустой список.
  const defaultResponsibles = users
    .filter((user) =>
      MANAGEMENT_ROLE_SET.has(user.role) || user.role === "operator"
    )
    .slice(0, 3)
    .map((user) => ({
      id: createId(),
      title: getUserDisplayTitle(user),
      userId: user.id,
    }));

  return {
    // Автозаполнение по умолчанию выключено — менеджер включает
    // вручную после того, как проверил список ответственных.
    autoFillEnabled: false,
    skipWeekends: false,
    mainResponsibleTitle: fallbackTitle,
    mainResponsibleUserId,
    ventilationEnabled: true,
    customDates: [],
    hiddenDates: [],
    extraPeriodicityLines: [],
    responsibles: defaultResponsibles,
    procedures: [
      {
        id: "disinfection",
        label: "Дезинфекция",
        enabled: true,
        times: ["14:00", "12:00", "23:00"],
        responsibleUserId: mainResponsibleUserId,
      },
      {
        id: "ventilation",
        label: "Проветривание",
        enabled: true,
        times: ["12:00", "10:00", "23:00"],
        responsibleUserId: mainResponsibleUserId,
      },
      {
        id: "wet_cleaning",
        label: "Влажная уборка",
        enabled: true,
        times: ["12:00", "18:00"],
        responsibleUserId: mainResponsibleUserId,
      },
    ],
  };
}

function normalizeProcedure(
  procedure: unknown,
  fallback: CleaningVentilationProcedureConfig,
  mainResponsibleUserId: string
): CleaningVentilationProcedureConfig {
  if (!procedure || typeof procedure !== "object" || Array.isArray(procedure)) {
    return { ...fallback };
  }

  const record = procedure as Record<string, unknown>;
  const times = Array.isArray(record.times)
    ? record.times.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : fallback.times;

  return {
    id:
      record.id === "disinfection" ||
      record.id === "ventilation" ||
      record.id === "wet_cleaning"
        ? record.id
        : fallback.id,
    label: typeof record.label === "string" && record.label.trim() ? record.label : fallback.label,
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    times: times.length > 0 ? times : fallback.times,
    responsibleUserId:
      typeof record.responsibleUserId === "string" && record.responsibleUserId
        ? record.responsibleUserId
        : mainResponsibleUserId || fallback.responsibleUserId,
  };
}

export function normalizeCleaningVentilationConfig(
  value: unknown,
  users: BasicUser[] = []
): CleaningVentilationChecklistConfig {
  const fallback = getDefaultCleaningVentilationConfig(users);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const mainResponsibleUserId =
    typeof record.mainResponsibleUserId === "string" && record.mainResponsibleUserId
      ? record.mainResponsibleUserId
      : fallback.mainResponsibleUserId;

  const procedureList = Array.isArray(record.procedures)
    ? (record.procedures as unknown[])
    : null;

  const procedures = procedureList
    ? fallback.procedures.map((item) => {
        const matched = procedureList.find(
          (candidate: unknown) =>
            candidate &&
            typeof candidate === "object" &&
            (candidate as Record<string, unknown>).id === item.id
        );
        return normalizeProcedure(matched, item, mainResponsibleUserId);
      })
    : fallback.procedures.map((item) => ({ ...item }));

  const ventilationEnabled =
    typeof record.ventilationEnabled === "boolean"
      ? record.ventilationEnabled
      : fallback.ventilationEnabled;

  return {
    autoFillEnabled:
      typeof record.autoFillEnabled === "boolean"
        ? record.autoFillEnabled
        : fallback.autoFillEnabled,
    skipWeekends:
      typeof record.skipWeekends === "boolean"
        ? record.skipWeekends
        : fallback.skipWeekends,
    mainResponsibleTitle:
      typeof record.mainResponsibleTitle === "string" && record.mainResponsibleTitle.trim()
        ? record.mainResponsibleTitle
        : fallback.mainResponsibleTitle,
    mainResponsibleUserId,
    ventilationEnabled,
    customDates: Array.isArray(record.customDates)
      ? record.customDates.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : [],
    hiddenDates: Array.isArray(record.hiddenDates)
      ? record.hiddenDates.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : [],
    extraPeriodicityLines: Array.isArray(record.extraPeriodicityLines)
      ? record.extraPeriodicityLines
          .filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
          .map((item) => item.trim())
      : [],
    responsibles: Array.isArray(record.responsibles)
      ? record.responsibles
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).userId === "string"
          )
          .map((item) => {
            const responsible = item as Record<string, unknown>;
            return {
              id:
                typeof responsible.id === "string" && responsible.id
                  ? responsible.id
                  : createId(),
              title:
                typeof responsible.title === "string" && responsible.title.trim()
                  ? responsible.title
                  : "Сотрудник",
              userId: responsible.userId as string,
            };
          })
      : fallback.responsibles.map((item) => ({ ...item })),
    // Процедуру проветривания НЕ выбрасываем при выключенном тумблере:
    // вместе с ней терялись настроенные времена, и включить обратно было
    // нечего. Видимость решает `ventilationEnabled` у потребителей.
    procedures: procedures.map((item) => ({ ...item })),
  };
}

export function normalizeCleaningVentilationEntryData(
  value: unknown
): CleaningVentilationChecklistEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { procedures: {} };
  }

  const record = value as Record<string, unknown>;
  const procedures: CleaningVentilationChecklistEntryData["procedures"] = {};

  if (record.procedures && typeof record.procedures === "object" && !Array.isArray(record.procedures)) {
    for (const [key, rawValue] of Object.entries(record.procedures as Record<string, unknown>)) {
      if (
        (key === "disinfection" || key === "ventilation" || key === "wet_cleaning") &&
        Array.isArray(rawValue)
      ) {
        procedures[key] = rawValue.filter(
          (item): item is string => typeof item === "string"
        );
      }
    }
  }

  return {
    procedures,
    responsibleUserId:
      typeof record.responsibleUserId === "string" ? record.responsibleUserId : undefined,
  };
}

/**
 * Пустая строка чек-листа: ни у одной процедуры нет отметок времени.
 * Такую строку автозаполнение имеет право перезаписать.
 */
export function isCleaningVentilationEntryDataEmpty(
  data: CleaningVentilationChecklistEntryData
): boolean {
  return Object.values(data.procedures).every(
    (times) => !times || times.length === 0
  );
}

/**
 * Строка автозаполнения: все включённые процедуры получают свои
 * типовые времена из config (зеркало демо-сида `buildVentilationRows`).
 */
export function buildCleaningVentilationAutoFillEntryData(
  config: CleaningVentilationChecklistConfig
): CleaningVentilationChecklistEntryData {
  const data: CleaningVentilationChecklistEntryData = {
    procedures: {},
    responsibleUserId: config.mainResponsibleUserId || undefined,
  };
  for (const procedure of config.procedures) {
    if (!procedure.enabled) continue;
    // Проветривание теперь остаётся в конфиге и при выключённом тумблере
    // (чтобы не терять времена) — фильтруем его здесь.
    if (procedure.id === "ventilation" && !config.ventilationEnabled) continue;
    data.procedures[procedure.id] = [...procedure.times];
  }
  return data;
}

/**
 * Локальная ISO-дата без ухода в UTC. `toISOString()` на дате, собранной
 * из локальных компонентов, сдвигал сутки назад в положительных TZ —
 * именно отсюда в таблицу заезжало «30.07» при дате начала 10.08 (V1).
 */
export function toLocalIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getMonthBoundsFromDate(isoDate: string) {
  const baseDate = new Date(`${isoDate}T00:00:00`);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  return {
    dateFrom: toLocalIsoDate(new Date(year, month, 1)),
    dateTo: toLocalIsoDate(new Date(year, month + 1, 0)),
  };
}

/**
 * V1: строки чек-листа идут ОТ ДАТЫ НАЧАЛА документа до конца её месяца.
 * Раньше отсчёт шёл от первого числа месяца, и документ с датой начала
 * 10.08 открывался строками с 30-31.07 — днями, которых в нём нет.
 *
 * Записи, сделанные раньше даты начала (перенос даты уже после
 * заполнения), не теряем: они приходят сюда через `customDates` и
 * добавляются к списку — данные важнее ровного периода.
 */
export function buildChecklistDateKeys(
  dateFrom: string,
  skipWeekends: boolean,
  customDates: string[] = [],
  hiddenDates: string[] = []
) {
  const { dateTo: monthEnd } = getMonthBoundsFromDate(dateFrom);
  const keys: string[] = [];
  const cursor = new Date(`${dateFrom}T00:00:00`);
  const endDate = new Date(`${monthEnd}T00:00:00`);

  while (cursor <= endDate) {
    const weekday = cursor.getDay();
    if (!skipWeekends || (weekday !== 0 && weekday !== 6)) {
      keys.push(toLocalIsoDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const customDate of customDates) {
    if (!keys.includes(customDate)) {
      keys.push(customDate);
    }
  }

  return keys.filter((item) => !hiddenDates.includes(item)).sort();
}

export function getCleaningVentilationFilePrefix() {
  return "cleaning-ventilation-checklist";
}
