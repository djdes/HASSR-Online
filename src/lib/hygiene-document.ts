import {
  getDistinctRoleLabels,
  getUserRoleLabel,
  getUserRoleSortOrder,
  normalizeUserRole,
} from "@/lib/user-roles";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";

export const HYGIENE_STATUS_OPTIONS = [
  { value: "healthy", code: "Зд.", label: "Здоров" },
  { value: "day_off", code: "В", label: "Выходной / отгул" },
  { value: "sick_leave", code: "Б/л", label: "Больничный лист" },
  { value: "suspended", code: "От", label: "Отстранён от работы" },
  { value: "vacation", code: "Отп", label: "Отпуск" },
] as const;

export type HygieneStatus = (typeof HYGIENE_STATUS_OPTIONS)[number]["value"];

export type HygieneEntryData = {
  status?: HygieneStatus | null;
  temperatureAbove37?: boolean | null;
};

export type HealthEntryData = {
  signed?: boolean | null;
  measures?: string | null;
};

// Коротко (замечание владельца по печати): раньше — «Ежесменно перед
// началом смены – всех для сотрудников производства; для других
// сотрудников компании – при визите на производственный участок
// (однократно перед проходом на участок)». Старый текст в config
// документов подменяется этим при чтении (control-periodicity.ts).
export const HYGIENE_REGISTER_PERIODICITY = [
  "Перед каждой сменой — сотрудники производства;",
  "остальные — перед входом на участок",
];

export const HYGIENE_REGISTER_NOTES = [
  "осмотра и опроса сотрудников о состоянии здоровья (проявлениях респираторных и кишечных заболеваний и инфекций);",
  "опроса сотрудников об отсутствии заболеваний верхних дыхательных путей и гнойничковых заболеваний кожи рук и открытых поверхностей тела;",
  "опроса сотрудников о контактах с людьми, перенесшими желудочно-кишечные инфекции, с больными и вернувшимися из другой страны или субъекта РФ;",
  "осмотра рук и открытых частей тела сотрудников на наличие гнойничковых заболеваний и нарушений целостности кожного покрова.",
];

/**
 * Легенда — ДОСЛОВНО как на эталоне lk.haccp-online.ru
 * (haccp-r2/hygiene-2-doc.png, H1 аудита):
 *
 *   Зд. – здоров;
 *   В – выходной / отпуск / отгул;
 *   Б/л – больничный лист / отстранен от работы по причине болезни
 *   ОТ – отстранен
 *   Отп – отпуск
 *
 * Отличия от прежней версии: вернулось «/ отпуск» во второй строке,
 * «От» стало «ОТ» заглавными, тире короткое «–» вместо «—», а «;»
 * стоят только там, где они есть у эталона (первые две строки).
 * Поэтому рендер вызывается с `autoPunctuation={false}` — знаки
 * препинания живут в самом тексте, а не дописываются компонентом.
 */
export const HYGIENE_REGISTER_LEGEND = [
  "Зд. – здоров;",
  "В – выходной / отпуск / отгул;",
  "Б/л – больничный лист / отстранен от работы по причине болезни",
  "ОТ – отстранен",
  "Отп – отпуск",
];

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export const HYGIENE_EXAMPLE_ORGANIZATION = ORG_NAME_FALLBACK;
export const HYGIENE_EXAMPLE_TITLE = "ГИГИЕНИЧЕСКИЙ ЖУРНАЛ";
export const HYGIENE_EXAMPLE_MONTH = "Апрель 2025 г.";
export const HYGIENE_EXAMPLE_DATE_FROM = "2025-04-01";
export const HYGIENE_EXAMPLE_DATE_TO = "2025-04-15";
export const HYGIENE_EXAMPLE_ROW_COUNT = 7;

export type HygieneRosterUser = {
  id: string;
  name: string;
  role: string;
  email?: string | null;
  positionTitle?: string | null;
};

export type HygieneExampleEmployee = {
  id: string;
  number: number;
  name: string | null;
  position: string | null;
};

export const HYGIENE_EXAMPLE_EMPLOYEES: HygieneExampleEmployee[] = Array.from(
  { length: HYGIENE_EXAMPLE_ROW_COUNT },
  (_, index) => ({
    id: `sample-${index + 1}`,
    number: index + 1,
    name: index === 0 ? "Иванов И.И." : null,
    position: index === 0 ? "Управляющий" : null,
  })
);

export type HygieneSampleDocument = {
  id: string;
  title: string;
  status: "active" | "closed";
  responsibleTitle: string | null;
  periodLabel: string;
};

export type HygieneDocumentStatus = "active" | "closed";

export type HygieneSeedDocumentConfig = {
  title: string;
  status: HygieneDocumentStatus;
  dateFrom: string;
  dateTo: string;
  variant?: "default" | "demo_team";
};

export const HYGIENE_DEMO_TEAM = [
  {
    email: "admin@haccp.local",
    name: "Администратор",
    role: "owner",
    positionTitle: "Управляющий",
  },
  {
    email: "chef@haccp.local",
    name: "Петров П.П.",
    role: "technologist",
    positionTitle: "Шеф-повар",
  },
  {
    email: "souschef@haccp.local",
    name: "Сидоров С.С.",
    role: "operator",
    positionTitle: "Су-шеф",
  },
  {
    email: "hotcook@haccp.local",
    name: "Антонова А.А.",
    role: "operator",
    positionTitle: "Повар горячего цеха",
  },
  {
    email: "coldcook@haccp.local",
    name: "Борисов Б.Б.",
    role: "operator",
    positionTitle: "Повар холодного цеха",
  },
  {
    email: "pastry@haccp.local",
    name: "Кузнецова К.К.",
    role: "operator",
    positionTitle: "Кондитер",
  },
  {
    email: "waiter@haccp.local",
    name: "Смирнова М.М.",
    role: "operator",
    positionTitle: "Официант",
  },
] as const;

export const HYGIENE_DEMO_TEAM_V2 = [
  {
    email: "admin@haccp.local",
    name: "Крылов Денис Сергеевич",
    role: "owner",
    positionTitle: "Управляющий",
  },
  {
    email: "quality@haccp.local",
    name: "Белова Елена Андреевна",
    role: "technologist",
    positionTitle: "Технолог по качеству",
  },
  {
    email: "souschef@haccp.local",
    name: "Никитин Павел Игоревич",
    role: "operator",
    positionTitle: "Су-шеф",
  },
  {
    email: "hotcook@haccp.local",
    name: "Волкова Анна Дмитриевна",
    role: "operator",
    positionTitle: "Повар горячего цеха",
  },
  {
    email: "coldcook@haccp.local",
    name: "Орлов Илья Максимович",
    role: "operator",
    positionTitle: "Повар холодного цеха",
  },
  {
    email: "pastry@haccp.local",
    name: "Мельникова Софья Романовна",
    role: "operator",
    positionTitle: "Кондитер",
  },
  {
    email: "storekeeper@haccp.local",
    name: "Кузьмин Артем Сергеевич",
    role: "operator",
    positionTitle: "Кладовщик",
  },
  {
    email: "sanitation@haccp.local",
    name: "Егорова Марина Викторовна",
    role: "operator",
    positionTitle: "Санитарный работник",
  },
] as const;

export const HYGIENE_SAMPLE_DOCUMENTS: HygieneSampleDocument[] = [
  {
    id: "sample-active-1",
    title: "Гигиенический журнал",
    status: "active",
    responsibleTitle: "Управляющий",
    periodLabel: "Апрель с 1 по 15",
  },
  {
    id: "sample-closed-1",
    title: "Гигиенический журнал",
    status: "closed",
    responsibleTitle: null,
    periodLabel: "Апрель с 16 по 30",
  },
];

export const HYGIENE_PERIODICITY_TEXT = HYGIENE_REGISTER_PERIODICITY.join(" ");

export const HEALTH_REGISTER_NOTES = [
  "Ежедневно каждый сотрудник, работающий в контакте с пищевыми продуктами, обязан поставить подпись об отсутствии у него диареи, рвоты, желтухи, боли в горле с лихорадкой, и таких же случаев у членов семьи, а также поражений, содержащих гной, таких, как фурункулы и инфицированные раны на руках и предплечьях, на шее или выше, или на любой другой открытой части тела, какие бы то ни было небольшие повреждения, например, гнойные и инфицированные раны на запястьях, предплечьях и открытых частях тела. А также о кишечных заболеваниях у членов семьи.",
  "С целью профилактики коронавируса сотрудник обязан сообщать о контакте с больными и людьми, приехавшими из другого региона РФ, другой страны последние 14 дней. Все контактные должны быть отстранены от работы.",
];

/**
 * Журнал здоровья ведётся в электронном виде (решение владельца
 * 2026-09-22): по умолчанию он выключен, а включённый отмечается вместе с
 * гигиеническим — сотрудник перед сменой ставит отметку по QR, и она идёт
 * в оба журнала (health-qr-flow.ts). Прежний текст с эталона — «заполняется
 * в бумажном виде» — этому противоречил. Печатается и на экране, и в PDF.
 */
export const HEALTH_REGISTER_REMINDER =
  "Отметки ставят сами сотрудники по QR гигиенического журнала перед сменой — одна отметка сразу в оба журнала.";

export function getHealthDocumentTitle() {
  return "Журнал здоровья";
}

export function getHygieneDocumentTitle() {
  return "Гигиенический журнал (сотрудники)";
}

function getRoleOrder(role: string): number {
  return getUserRoleSortOrder(role);
}

export function getHygienePositionLabel(role: string): string {
  return getUserRoleLabel(role);
}

export function getHygieneUserPositionLabel(employee: HygieneRosterUser): string {
  // Демо-должность — только по служебной почте демо-команды. По ФИО не
  // сопоставляем: живой сотрудник с тем же ФИО получал чужую должность.
  const byEmail = HYGIENE_DEMO_TEAM_V2.find(
    (member) => employee.email && member.email === employee.email
  );
  if (byEmail) return byEmail.positionTitle;

  if (employee.positionTitle) return employee.positionTitle;

  return getHygienePositionLabel(employee.role);
}

export function getHygieneDemoTeamUsers(
  employees: HygieneRosterUser[]
): HygieneRosterUser[] {
  const demoUsers: HygieneRosterUser[] = [];

  HYGIENE_DEMO_TEAM_V2.forEach((member) => {
    // Только по почте демо-команды — совпадение ФИО ничего не значит.
    const user = employees.find((employee) => employee.email === member.email);
    if (!user) return;
    demoUsers.push({
      ...user,
      positionTitle: member.positionTitle,
    });
  });

  return demoUsers;
}

export function getHygieneDefaultResponsibleTitle(
  employees: HygieneRosterUser[]
): string {
  const owner = employees.find(
    (employee) => normalizeUserRole(employee.role) === "manager"
  );
  if (owner) return getHygienePositionLabel(owner.role);

  const technologist = employees.find(
    (employee) => normalizeUserRole(employee.role) === "head_chef"
  );
  if (technologist) return getHygienePositionLabel(technologist.role);

  const firstEmployee = employees[0];
  return firstEmployee
    ? getHygienePositionLabel(firstEmployee.role)
    : "Управляющий";
}

export function getHygieneResponsibleTitleOptions(
  employees: HygieneRosterUser[]
): string[] {
  return getDistinctRoleLabels(employees);
}

export function getStaffJournalResponsibleTitleOptions(
  employees: HygieneRosterUser[]
): string[] {
  return getHygieneResponsibleTitleOptions(employees);
}

export function getHygienePeriodLabel(dateFrom: Date | string, dateTo: Date | string) {
  const start = coerceUtcDate(dateFrom);
  const end = coerceUtcDate(dateTo);
  return `${MONTH_NAMES[start.getUTCMonth()]} с ${start.getUTCDate()} по ${end.getUTCDate()}`;
}

export function getHygieneCreatePeriodBounds(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();

  if (day <= 15) {
    return {
      dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      dateTo: `${year}-${String(month + 1).padStart(2, "0")}-15`,
    };
  }

  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-16`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function getHygieneSeedDocumentConfigs(): HygieneSeedDocumentConfig[] {
  return [
    {
      title: "Гигиенический журнал (сотрудники) — пример на 7 сотрудников",
      status: "active",
      dateFrom: "2026-04-01",
      dateTo: "2026-04-15",
      variant: "demo_team",
    },
    {
      title: getHygieneDocumentTitle(),
      status: "closed",
      dateFrom: "2026-04-16",
      dateTo: "2026-04-30",
    },
  ];
}

export function getHealthSeedDocumentConfigs(): HygieneSeedDocumentConfig[] {
  return [
    {
      title: getHealthDocumentTitle(),
      status: "active",
      dateFrom: "2026-04-01",
      dateTo: "2026-04-15",
    },
    {
      title: getHealthDocumentTitle(),
      status: "closed",
      dateFrom: "2026-04-16",
      dateTo: "2026-04-30",
    },
  ];
}

export function buildHygieneExampleEmployees(
  employees: HygieneRosterUser[],
  rowCount = HYGIENE_EXAMPLE_ROW_COUNT
): HygieneExampleEmployee[] {
  const sortedEmployees = [...employees].sort((left, right) => {
    const roleDiff = getRoleOrder(left.role) - getRoleOrder(right.role);
    if (roleDiff !== 0) return roleDiff;
    return left.name.localeCompare(right.name, "ru");
  });

  const rows: HygieneExampleEmployee[] = sortedEmployees
    .slice(0, rowCount)
    .map((employee, index) => ({
      id: employee.id,
      number: index + 1,
      name: employee.name,
      position: getHygieneUserPositionLabel(employee),
    }));

  while (rows.length < rowCount) {
    rows.push({
      id: `blank-${rows.length + 1}`,
      number: rows.length + 1,
      name: null,
      position: null,
    });
  }

  return rows;
}

export function coerceUtcDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    );
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(value);
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
}

export function toDateKey(value: Date | string): string {
  const date = coerceUtcDate(value);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function fromDateKey(dateKey: string): Date {
  return coerceUtcDate(dateKey);
}

export function buildDateKeys(dateFrom: Date | string, dateTo: Date | string): string[] {
  const start = coerceUtcDate(dateFrom);
  const end = coerceUtcDate(dateTo);
  const dates: string[] = [];

  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(toDateKey(cursor));
  }

  return dates;
}

export function buildFixedHygieneExampleDateKeys(): string[] {
  return buildDateKeys(HYGIENE_EXAMPLE_DATE_FROM, HYGIENE_EXAMPLE_DATE_TO);
}

export function formatMonthLabel(dateFrom: Date | string, dateTo: Date | string): string {
  const start = coerceUtcDate(dateFrom);
  const end = coerceUtcDate(dateTo);

  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()} г.`;
  }

  return `${toDateKey(start)} — ${toDateKey(end)}`;
}

export function getDayNumber(dateKey: string): number {
  return fromDateKey(dateKey).getUTCDate();
}

export function getWeekdayShort(dateKey: string): string {
  return WEEKDAY_SHORT[fromDateKey(dateKey).getUTCDay()] || "";
}

export function isWeekend(dateKey: string): boolean {
  const weekday = fromDateKey(dateKey).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function getRoleLabel(role: string): string {
  return getUserRoleLabel(role);
}

export function getStatusMeta(status?: string | null) {
  return HYGIENE_STATUS_OPTIONS.find((option) => option.value === status) || null;
}

export function normalizeHygieneEntryData(data: unknown): HygieneEntryData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }

  const record = data as Record<string, unknown>;
  const status =
    typeof record.status === "string" &&
    HYGIENE_STATUS_OPTIONS.some((option) => option.value === record.status)
      ? (record.status as HygieneStatus)
      : undefined;

  const temperatureAbove37 =
    typeof record.temperatureAbove37 === "boolean"
      ? record.temperatureAbove37
      : null;

  // Отметка по QR (подписи сотрудника, время, источник) и допуск
  // ответственного: таблица сайта перестраивает строку через этот
  // нормализатор, и без них первая же правка стирала бы подписи.
  const passthrough: Record<string, unknown> = {};
  for (const key of HYGIENE_QR_KEYS) {
    if (record[key] !== undefined && record[key] !== null) passthrough[key] = record[key];
  }

  return {
    status,
    temperatureAbove37,
    ...passthrough,
  };
}

/** Поля отметки по QR и допуска, которые переживают правку таблицы. */
const HYGIENE_QR_KEYS = ["confirmations", "confirmedAt", "source", "verification", "editedById", "editedByName"] as const;

type HygieneRowPattern = Array<{
  from: number;
  to: number;
  data: HygieneEntryData;
}>;

const HYGIENE_EXAMPLE_PATTERNS: HygieneRowPattern[] = [
  [
    { from: 1, to: 9, data: { status: "healthy", temperatureAbove37: false } },
    { from: 10, to: 11, data: { status: "day_off", temperatureAbove37: null } },
    { from: 12, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
  [
    { from: 1, to: 9, data: { status: "healthy", temperatureAbove37: false } },
    { from: 10, to: 10, data: { status: "day_off", temperatureAbove37: null } },
    { from: 11, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
  [
    { from: 1, to: 6, data: { status: "healthy", temperatureAbove37: false } },
    { from: 7, to: 8, data: { status: "day_off", temperatureAbove37: null } },
    { from: 9, to: 9, data: { status: "healthy", temperatureAbove37: false } },
    { from: 10, to: 11, data: { status: "day_off", temperatureAbove37: null } },
    { from: 12, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
  [
    { from: 1, to: 9, data: { status: "healthy", temperatureAbove37: false } },
    { from: 10, to: 11, data: { status: "day_off", temperatureAbove37: null } },
    { from: 12, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
  [
    { from: 1, to: 9, data: { status: "healthy", temperatureAbove37: false } },
    { from: 10, to: 11, data: { status: "day_off", temperatureAbove37: null } },
    { from: 12, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
  [
    { from: 1, to: 10, data: { status: "healthy", temperatureAbove37: false } },
    { from: 11, to: 11, data: { status: "day_off", temperatureAbove37: null } },
    { from: 12, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
  [
    { from: 1, to: 9, data: { status: "healthy", temperatureAbove37: false } },
    { from: 10, to: 11, data: { status: "day_off", temperatureAbove37: null } },
    { from: 12, to: 15, data: { status: "healthy", temperatureAbove37: false } },
  ],
];

export function buildExampleHygieneEntryMap(
  employeeIds: string[] = HYGIENE_EXAMPLE_EMPLOYEES.map((employee) => employee.id),
  dateKeys = buildFixedHygieneExampleDateKeys()
): Record<string, HygieneEntryData> {
  const map: Record<string, HygieneEntryData> = {};

  function setEntry(
    employeeId: string,
    dayNumber: number,
    data: HygieneEntryData
  ) {
    const dateKey = dateKeys[dayNumber - 1];
    if (!dateKey) return;
    map[`${employeeId}:${dateKey}`] = data;
  }

  function fillRange(
    employeeId: string,
    from: number,
    to: number,
    data: HygieneEntryData
  ) {
    for (let day = from; day <= to; day += 1) {
      setEntry(employeeId, day, data);
    }
  }

  employeeIds.slice(0, HYGIENE_EXAMPLE_PATTERNS.length).forEach((employeeId, index) => {
    const pattern = HYGIENE_EXAMPLE_PATTERNS[index];
    if (!pattern) return;

    pattern.forEach((segment) => {
      fillRange(employeeId, segment.from, segment.to, segment.data);
    });

    if (dateKeys.length > 15) {
      fillRange(employeeId, 16, dateKeys.length, {
        status: "healthy",
        temperatureAbove37: false,
      });
    }
  });

  return map;
}

export function normalizeHealthEntryData(data: unknown): HealthEntryData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }

  const record = data as Record<string, unknown>;

  return {
    signed: typeof record.signed === "boolean" ? record.signed : null,
    measures: typeof record.measures === "string" ? record.measures : null,
  };
}

export function getDefaultEntryDataForTemplate(
  templateCode: string
): HygieneEntryData | HealthEntryData {
  if (templateCode === "health_check") {
    return { signed: true, measures: null };
  }

  return {
    status: "healthy",
    temperatureAbove37: false,
  };
}

/**
 * Служебные ключи ячейки, которые НЕ являются заполнением. `_autoSeeded`
 * кладёт посев строк при создании документа (см.
 * `journal-document-entries-seed.ts`) — это болванка «строка есть,
 * данных нет».
 */
const SERVICE_ENTRY_KEYS = new Set(["_autoSeeded"]);

export function isEntryDataEmpty(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return true;
  }

  // Без этого фильтра автосозданный документ НИКОГДА не автозаполнялся:
  // посев клал `{ _autoSeeded: true }`, ячейка считалась непустой, и
  // автозаполнение её пропускало.
  return Object.keys(data as Record<string, unknown>).every((key) =>
    SERVICE_ENTRY_KEYS.has(key)
  );
}

export function getJournalHeading(templateCode: string): string {
  const base =
    templateCode === "health_check" ? getHealthDocumentTitle() : getHygieneDocumentTitle();
  return base;
}
