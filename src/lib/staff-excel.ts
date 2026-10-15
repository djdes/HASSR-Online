import { formatWeeklyDaysOff, parseWeeklyDaysOff } from "@/lib/staff-bulk-parse";

/**
 * Формат файла со списком сотрудников.
 *
 * Один и тот же набор колонок обслуживает экспорт, шаблон для заполнения
 * и импорт. Это не экономия строк, а гарантия: шаблон, выданный из
 * другого места, однажды разойдётся с тем, что умеет читать импорт, и
 * человек получит «файл не подходит» на файле, который мы сами и выдали.
 */

export const STAFF_SHEET_NAME = "Сотрудники";

/** Логин синтетический, если он не адрес человека, а заглушка. */
export function isSyntheticLogin(email: string | null | undefined): boolean {
  return Boolean(email && email.endsWith(".local.haccp"));
}

export type StaffColumn = {
  key: string;
  header: string;
  width: number;
  /// Колонка читается при импорте. Остальные — справочные, только вывод.
  imported: boolean;
  hint: string;
};

export const STAFF_COLUMNS: StaffColumn[] = [
  {
    key: "fullName",
    header: "ФИО",
    width: 30,
    imported: true,
    hint: "Обязательно. Как в документах.",
  },
  {
    key: "position",
    header: "Должность",
    width: 24,
    imported: true,
    hint: "Обязательно. Должность должна уже существовать в организации.",
  },
  {
    key: "phone",
    header: "Телефон",
    width: 18,
    imported: true,
    hint: "Необязательно. По нему сотрудник входит через Telegram.",
  },
  {
    key: "contactEmail",
    header: "Почта",
    width: 26,
    imported: true,
    hint: "Необязательно. Куда присылать напоминания.",
  },
  {
    key: "daysOff",
    header: "Выходные",
    width: 16,
    imported: true,
    hint: "Например «Сб, Вс». Пусто — выходных нет.",
  },
  {
    key: "journals",
    header: "Журналы",
    width: 40,
    imported: true,
    hint: "«по должности» — набор наследуется. Иначе названия через «;».",
  },
  {
    key: "login",
    header: "Логин",
    width: 26,
    imported: false,
    hint: "Только для справки, при загрузке не читается.",
  },
  {
    key: "telegram",
    header: "Telegram",
    width: 14,
    imported: false,
    hint: "Только для справки: подключён сотрудник к боту или нет.",
  },
  {
    key: "status",
    header: "Статус",
    width: 12,
    imported: false,
    hint: "Только для справки: активен или в архиве.",
  },
];

export const INHERIT_JOURNALS_LABEL = "по должности";

export type StaffExportRow = {
  fullName: string;
  position: string;
  phone: string;
  contactEmail: string;
  daysOff: string;
  journals: string;
  login: string;
  telegram: string;
  status: string;
};

export function buildStaffExportRow(user: {
  name: string | null;
  positionTitle: string | null;
  jobPositionName?: string | null;
  phone: string | null;
  contactEmail: string | null;
  email: string | null;
  weeklyDaysOff: number[];
  telegramChatId: string | null;
  isActive: boolean;
  archivedAt: Date | null;
  journalAccessMigrated: boolean;
  journalNames: string[];
}): StaffExportRow {
  return {
    fullName: user.name ?? "",
    position: user.jobPositionName ?? user.positionTitle ?? "",
    phone: user.phone ?? "",
    contactEmail: user.contactEmail ?? "",
    daysOff: formatWeeklyDaysOff(user.weeklyDaysOff),
    // Ненастроенный доступ показываем словами, а не пустотой: пустая
    // ячейка при обратной загрузке означала бы «отобрать все журналы».
    journals: user.journalAccessMigrated
      ? user.journalNames.join("; ")
      : INHERIT_JOURNALS_LABEL,
    login: isSyntheticLogin(user.email) ? "" : (user.email ?? ""),
    telegram: user.telegramChatId ? "Подключён" : "—",
    status: user.archivedAt || !user.isActive ? "Архив" : "Активен",
  };
}

export type StaffImportRow = {
  line: number;
  fullName: string;
  positionName: string;
  phone: string;
  contactEmail: string;
  weeklyDaysOff: number[];
  /// null — наследовать от должности.
  journalNames: string[] | null;
};

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // ExcelJS отдаёт формулы и rich text объектами — берём читаемое.
    const rich = value as { text?: unknown; result?: unknown };
    if (typeof rich.text === "string") return rich.text.trim();
    if (typeof rich.result === "string") return rich.result.trim();
    return "";
  }
  return String(value).trim();
}

/**
 * Разбор строк файла в заявки на импорт.
 *
 * Заголовок ищем по названиям колонок, а не по позиции: человек может
 * переставить столбцы местами или удалить справочные, и ронять из-за
 * этого импорт незачем.
 */
export type StaffSheetErrorCode =
  | "missingColumns"
  | "missingName"
  | "missingPosition"
  | "positionNotFound"
  | "invalidPhone"
  | "unknownJournals"
  | "seatLimit";
export type StaffSheetError = {
  line: number;
  message: string;
  code: StaffSheetErrorCode;
  params?: Record<string, string>;
};

export function parseStaffSheet(rows: unknown[][]): {
  rows: StaffImportRow[];
  errors: StaffSheetError[];
} {
  const result: StaffImportRow[] = [];
  const errors: StaffSheetError[] = [];
  if (rows.length === 0) return { rows: result, errors };

  const header = (rows[0] ?? []).map((value) => cell(value).toLowerCase());
  const indexOf = (key: string) => {
    const column = STAFF_COLUMNS.find((item) => item.key === key);
    if (!column) return -1;
    return header.findIndex(
      (title) => title === column.header.toLowerCase()
    );
  };

  const columnIndex = {
    fullName: indexOf("fullName"),
    position: indexOf("position"),
    phone: indexOf("phone"),
    contactEmail: indexOf("contactEmail"),
    daysOff: indexOf("daysOff"),
    journals: indexOf("journals"),
  };

  if (columnIndex.fullName < 0 || columnIndex.position < 0) {
    errors.push({
      line: 1,
      code: "missingColumns",
      message:
        "В файле нет колонок «ФИО» и «Должность». Скачайте шаблон и заполните его.",
    });
    return { rows: result, errors };
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const line = i + 1;
    const at = (index: number) => (index >= 0 ? cell(row[index]) : "");

    const fullName = at(columnIndex.fullName);
    const positionName = at(columnIndex.position);

    // Полностью пустая строка — не ошибка: в конце файла их всегда
    // несколько, и ругаться на них значит утопить настоящие ошибки.
    if (!fullName && !positionName && row.every((value) => !cell(value))) {
      continue;
    }
    if (!fullName) {
      errors.push({ line, code: "missingName", message: "Не заполнено ФИО" });
      continue;
    }
    if (!positionName) {
      errors.push({ line, code: "missingPosition", params: { name: fullName }, message: `«${fullName}»: не указана должность` });
      continue;
    }

    const journalsRaw = at(columnIndex.journals);
    const journalNames =
      !journalsRaw ||
      journalsRaw.toLowerCase() === INHERIT_JOURNALS_LABEL.toLowerCase()
        ? null
        : journalsRaw
            .split(";")
            .map((name) => name.trim())
            .filter(Boolean);

    result.push({
      line,
      fullName,
      positionName,
      phone: at(columnIndex.phone),
      contactEmail: at(columnIndex.contactEmail),
      weeklyDaysOff: parseWeeklyDaysOff(at(columnIndex.daysOff)),
      journalNames,
    });
  }

  return { rows: result, errors };
}
