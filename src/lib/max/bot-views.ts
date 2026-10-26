import { pluralRu } from "@/lib/plural-ru";
import type { MaxButton, MaxView } from "./client";

/**
 * Экраны бота MAX без заполнения журнала (оно — в `bot-fill.ts`).
 * Только callback-кнопки: всё происходит в чате, без мини-сайта.
 *
 * Нажатия верхнего уровня:
 *   menu · today · help · sum · rem · remok
 *   jr:<страница> — все журналы; go:<код>[:<документ>] — заполнить;
 *   obj:<код> — журнал объектов (по наклейке);
 *   orgs:<страница>, org:<id> — организации;
 *   inv:<страница>, invu:<id сотрудника> — подключить сотрудника.
 */
export type BotPayload =
  | { kind: "menu" | "today" | "help" | "summary" | "remind" | "remindConfirm" }
  | { kind: "journals" | "orgs" | "invites"; page: number }
  | { kind: "fill"; code: string; documentId: string | null }
  | { kind: "object"; code: string }
  | { kind: "org"; id: string }
  | { kind: "invite"; userId: string };

const CODE = "[a-z0-9_]{1,60}";
const ID = "[A-Za-z0-9_-]{1,100}";

export function parseBotPayload(raw: string): BotPayload | null {
  const text = raw.trim();
  const simple: Record<string, BotPayload["kind"]> = {
    menu: "menu", "/menu": "menu", "/start": "menu", меню: "menu",
    today: "today", "/tasks": "today", "/today": "today",
    help: "help", "/help": "help",
    sum: "summary", "/summary": "summary",
    rem: "remind", remok: "remindConfirm",
    "/journals": "journals", "/organizations": "orgs", "/staff": "invites",
  };
  const plain = simple[text.toLowerCase()];
  if (plain === "journals" || plain === "orgs" || plain === "invites") return { kind: plain, page: 0 };
  if (plain) return { kind: plain } as BotPayload;
  let match = /^(jr|journals|orgs|inv):(\d{1,3})$/.exec(text);
  if (match) return { kind: match[1] === "orgs" ? "orgs" : match[1] === "inv" ? "invites" : "journals", page: Number(match[2]) };
  match = new RegExp(`^go:(${CODE})(?::(${ID}))?$`).exec(text);
  if (match) return { kind: "fill", code: match[1], documentId: match[2] ?? null };
  match = new RegExp(`^obj:(${CODE})$`).exec(text);
  if (match) return { kind: "object", code: match[1] };
  match = new RegExp(`^org:(${ID})$`).exec(text);
  if (match) return { kind: "org", id: match[1] };
  match = new RegExp(`^invu:(${ID})$`).exec(text);
  if (match) return { kind: "invite", userId: match[1] };
  return null;
}

const cb = (text: string, payload: string): MaxButton => ({ type: "callback", text: text.length > 64 ? `${text.slice(0, 63)}…` : text, payload });
const staff = (count: number, one: string, few: string, many: string) => `${count} ${pluralRu(count, one, few, many)}`;
const MENU_ROW: MaxButton[] = [cb("🏠 Меню", "menu")];
const PAGE = 8;

function pageSlice<T>(items: readonly T[], page: number): { slice: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { slice: items.slice(current * PAGE, current * PAGE + PAGE), page: current, pages };
}

function pager(prefix: string, page: number, pages: number): MaxButton[] {
  const row: MaxButton[] = [];
  if (page > 0) row.push(cb("‹ Назад", `${prefix}:${page - 1}`));
  if (page + 1 < pages) row.push(cb("Далее ›", `${prefix}:${page + 1}`));
  return row;
}

function listNames(names: readonly string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} и ещё ${names.length - limit}`;
}

export type BotTask = { code: string; name: string; done: boolean; object: boolean };

export type MenuData = {
  userName: string;
  organizationName: string;
  dateLabel: string;
  /** Заполнять журналы из бота можно (своя организация, право заполнения). */
  canFill: boolean;
  /** Почему нельзя — показывается вместо задач. */
  fillNote?: string | null;
  tasks: BotTask[];
  manager: boolean;
  multipleOrganizations: boolean;
};

export function menuView(data: MenuData): MaxView {
  const lines = [`👋 ${data.userName}`, `${data.organizationName} · ${data.dateLabel}`, ""];
  const buttons: MaxButton[][] = [];
  if (data.canFill) {
    const pending = data.tasks.filter((task) => !task.done);
    const done = data.tasks.length - pending.length;
    if (data.tasks.length === 0) lines.push("На сегодня задач нет. Журнал можно заполнить через «Все журналы».");
    else if (pending.length === 0) lines.push(`Сегодня всё заполнено ✅ (${done} из ${data.tasks.length}). Спасибо!`);
    else lines.push(`Сегодня заполнено ${done} из ${data.tasks.length}.`, `Осталось: ${listNames(pending.map((task) => task.name))}.`);
    const next = pending.find((task) => !task.object);
    if (next) buttons.push([cb(`✍️ Заполнить: ${next.name}`, `go:${next.code}`)]);
    buttons.push([cb("📋 Мои задачи на сегодня", "today")], [cb("📚 Все журналы", "jr:0")]);
  } else {
    lines.push(data.fillNote ?? "Заполнение журналов вам не назначено.");
  }
  if (data.manager) {
    lines.push("", "Для руководителя: сводка дня, напоминания сотрудникам и подключение новых сотрудников к боту.");
    buttons.push([cb("📊 Сводка за сегодня", "sum")], [cb("🔔 Напомнить не заполнившим", "rem")], [cb("👥 Подключить сотрудника", "inv:0")]);
  }
  const tail = [cb("❓ Как это работает", "help")];
  if (data.multipleOrganizations) tail.push(cb("🏢 Организация", "orgs:0"));
  buttons.push(tail);
  return { text: lines.join("\n"), buttons };
}

export function todayView(data: { dateLabel: string; tasks: BotTask[] }): MaxView {
  const lines = [`📋 Мои задачи на ${data.dateLabel}`, ""];
  const buttons: MaxButton[][] = [];
  if (data.tasks.length === 0) lines.push("На сегодня задач нет. Если нужно сделать запись — откройте «Все журналы».");
  const ordered = [...data.tasks].sort((a, b) => Number(a.done) - Number(b.done));
  for (const task of ordered) {
    lines.push(`${task.done ? "✅" : task.object ? "🏷" : "⏳"} ${task.name}${task.object && !task.done ? " — по наклейке на объекте" : ""}`);
    if (!task.done) buttons.push([cb(`${task.object ? "🏷" : "✍️"} ${task.name}`, task.object ? `obj:${task.code}` : `go:${task.code}`)]);
  }
  if (data.tasks.length && data.tasks.every((task) => task.done)) lines.push("", "Всё заполнено. Спасибо!");
  buttons.splice(20);
  buttons.push([cb("📚 Все журналы", "jr:0")], MENU_ROW);
  return { text: lines.join("\n"), buttons };
}

export function journalsView(data: { organizationName: string; journals: Array<{ code: string; name: string; object: boolean }>; page: number }): MaxView {
  const { slice, page, pages } = pageSlice(data.journals, data.page);
  const lines = [`📚 Журналы · ${data.organizationName}`, ""];
  if (data.journals.length === 0) {
    lines.push("Сегодня нет журналов, которые вам можно заполнить. Если это ошибка — попросите руководителя проверить доступ в вашей карточке сотрудника.");
  } else {
    lines.push("Выберите журнал — бот задаст вопросы по порядку.");
    if (data.journals.some((journal) => journal.object)) lines.push("🏷 — холодильники, склады и лампы: их заполняют по QR-наклейке на самом объекте.");
    if (pages > 1) lines.push(`Страница ${page + 1} из ${pages}.`);
  }
  const buttons: MaxButton[][] = slice.map((journal) => [cb(`${journal.object ? "🏷 " : ""}${journal.name}`, journal.object ? `obj:${journal.code}` : `go:${journal.code}`)]);
  const nav = pager("jr", page, pages);
  if (nav.length) buttons.push(nav);
  buttons.push(MENU_ROW);
  return { text: lines.join("\n"), buttons };
}

export function objectJournalView(data: { name: string; hint: string }): MaxView {
  return { text: `🏷 ${data.name}\n\n${data.hint}\n\nНаведите камеру телефона на QR-наклейку объекта — откроется именно он.`, buttons: [[cb("📚 Все журналы", "jr:0")], MENU_ROW] };
}

export function helpView(manager: boolean): MaxView {
  const lines = [
    "❓ Как это работает",
    "",
    "1. Нажмите «Заполнить» или выберите журнал в «Все журналы».",
    "2. Бот задаёт вопросы по одному. Отвечайте кнопками; числа и текст — обычным сообщением.",
    "3. В конце проверьте запись и нажмите «Сохранить». Ошиблись — «Изменить» или «‹ Назад».",
    "",
    "«✖ Отменить» в любой момент — ничего не запишется.",
    "Если температура вне нормы, бот спросит, что вы сделали, — ответ попадёт в журнал.",
    "Холодильники, склады и УФ-лампы заполняют по QR-наклейке на самом объекте.",
  ];
  if (manager) {
    lines.push(
      "",
      "Руководителю:",
      "• «Сводка за сегодня» — кто что не заполнил.",
      "• «Напомнить не заполнившим» — бот напишет каждому подключённому сотруднику.",
      "• «Подключить сотрудника» — личная ссылка: перешлите её сотруднику, он нажмёт и сразу попадёт в свои журналы."
    );
  }
  lines.push("", "Меню — команда /menu или кнопка ниже.");
  return { text: lines.join("\n"), buttons: [MENU_ROW] };
}

/** `self` — сам руководитель: в сводке виден, напоминание себе не отправляется. */
export type SummaryRow = { name: string; journals: string[]; inMax: boolean; self?: boolean };

export function summaryView(data: { organizationName: string; dateLabel: string; total: number; done: number; rows: SummaryRow[] }): MaxView {
  const lines = [`📊 Сводка за ${data.dateLabel}`, data.organizationName, ""];
  if (data.total === 0) {
    lines.push("На сегодня обязательных записей нет.");
  } else {
    const percent = Math.round((data.done / data.total) * 100);
    lines.push(`Заполнено ${data.done} из ${data.total} (${percent}%).`);
    if (data.rows.length === 0) lines.push("Все сотрудники заполнили свои журналы ✅");
    else {
      lines.push(`Не заполнили: ${data.rows.length}.`, "");
      for (const row of data.rows.slice(0, 15)) lines.push(`• ${row.name} — ${listNames(row.journals, 2)}${row.inMax ? "" : " (нет в MAX)"}`);
      if (data.rows.length > 15) lines.push(`…и ещё ${data.rows.length - 15}.`);
    }
  }
  const buttons: MaxButton[][] = [];
  const reachable = data.rows.filter((row) => row.inMax && !row.self).length;
  if (reachable > 0) buttons.push([cb(`🔔 Напомнить (${reachable} в MAX)`, "rem")]);
  if (data.rows.some((row) => !row.inMax)) buttons.push([cb("👥 Подключить сотрудника", "inv:0")]);
  buttons.push([cb("🔄 Обновить", "sum")], MENU_ROW);
  return { text: lines.join("\n"), buttons };
}

export function remindConfirmView(data: { reachable: number; notInMax: number; waitMinutes: number | null }): MaxView {
  if (data.waitMinutes !== null) {
    return { text: `🔔 Напоминание уже отправляли недавно. Следующее — через ${data.waitMinutes} мин.`, buttons: [[cb("📊 Сводка за сегодня", "sum")], MENU_ROW] };
  }
  if (data.reachable === 0) {
    const text = data.notInMax > 0
      ? `🔔 Некому отправить: ${staff(data.notInMax, "сотрудник", "сотрудника", "сотрудников")} с незаполненными журналами ещё не в MAX. Подключите их — тогда бот сможет напоминать.`
      : "🔔 Напоминать некому — все сотрудники заполнили журналы ✅";
    return { text, buttons: [...(data.notInMax > 0 ? [[cb("👥 Подключить сотрудника", "inv:0")]] : []), MENU_ROW] };
  }
  const lines = [`🔔 Отправить напоминание ${staff(data.reachable, "сотруднику", "сотрудникам", "сотрудникам")} в MAX?`, "Каждый получит список своих незаполненных журналов и кнопку «Заполнить»."];
  if (data.notInMax > 0) lines.push("", `Ещё ${staff(data.notInMax, "сотрудник", "сотрудника", "сотрудников")} не в MAX — им напомните лично.`);
  return { text: lines.join("\n"), buttons: [[cb("✅ Отправить", "remok")], [cb("‹ Не отправлять", "menu")]] };
}

export function reminderMessage(data: { name: string; journals: Array<{ code: string; name: string; object?: boolean }> }): MaxView {
  const lines = ["🔔 Напоминание от руководителя", "", `${data.name}, сегодня осталось заполнить:`, ...data.journals.slice(0, 10).map((journal) => `• ${journal.name}${journal.object ? " — по наклейке на объекте" : ""}`)];
  const first = data.journals.find((journal) => !journal.object);
  return { text: lines.join("\n"), buttons: [...(first ? [[cb(`✍️ Заполнить: ${first.name}`, `go:${first.code}`)]] : []), [cb("📋 Мои задачи на сегодня", "today")]] };
}

export type InviteCandidate = { id: string; name: string; position: string | null };

export function inviteListView(data: { candidates: InviteCandidate[]; connected: number; total: number; page: number }): MaxView {
  const { slice, page, pages } = pageSlice(data.candidates, data.page);
  const lines = ["👥 Подключить сотрудника", `Уже в MAX: ${data.connected} из ${data.total}.`, ""];
  if (data.candidates.length === 0) lines.push("Все сотрудники уже подключены ✅");
  else lines.push("Выберите сотрудника — бот даст личную ссылку. Перешлите её сотруднику: он нажмёт и сразу попадёт в свои журналы.");
  const buttons: MaxButton[][] = slice.map((candidate) => [cb(`${candidate.name}${candidate.position ? ` · ${candidate.position}` : ""}`, `invu:${candidate.id}`)]);
  const nav = pager("inv", page, pages);
  if (nav.length) buttons.push(nav);
  buttons.push(MENU_ROW);
  return { text: lines.join("\n"), buttons };
}

export function inviteIssuedView(data: { name: string; validDays: number }): MaxView {
  return {
    text: `✅ Ссылка для «${data.name}» готова — ниже отдельным сообщением.\n\nПерешлите то сообщение сотруднику в MAX (удерживайте его → «Переслать»). Ссылка сработает один раз и действует ${data.validDays} дней. Новая ссылка отменяет прежнюю.`,
    buttons: [[cb("👥 Подключить ещё", "inv:0")], MENU_ROW],
  };
}

export function inviteForwardText(data: { url: string; code: string; organizationName: string }): string {
  return `Здравствуйте! Подключитесь к журналам ${data.organizationName} в MAX — так их можно заполнять прямо в чате.\n\n1. Откройте ссылку: ${data.url}\n2. Нажмите «Начать».\n\nЕсли бот не ответил, отправьте ему код:\n${data.code}`;
}

export function unlinkedView(siteUrl: string): MaxView {
  return {
    text: "Здравствуйте! Это бот журналов WeSetup.\n\nСотрудникам: попросите руководителя прислать личную ссылку-приглашение и нажмите её — журналы появятся здесь.\n\nРуководителям: войдите на сайт WeSetup, нажмите значок MAX и «Связать мой MAX».",
    buttons: [[{ type: "link", text: "Подключить на сайте", url: siteUrl }]],
  };
}

export function organizationsView(data: { organizations: Array<{ id: string; name: string }>; activeId: string; page: number }): MaxView {
  const { slice, page, pages } = pageSlice(data.organizations, data.page);
  const buttons: MaxButton[][] = slice.map((org) => [cb(`${org.id === data.activeId ? "✓ " : ""}${org.name}`, `org:${org.id}`)]);
  const nav = pager("orgs", page, pages);
  if (nav.length) buttons.push(nav);
  buttons.push(MENU_ROW);
  return { text: "🏢 Выберите организацию. Журналы и права — как на сайте.", buttons };
}

export function messageView(text: string): MaxView {
  return { text, buttons: [MENU_ROW] };
}
