/**
 * Русские названия для «Журнала действий» (`/settings/audit`).
 *
 * Раньше страница показывала сырьё из базы: `attachment.upload`,
 * `employee.self_registered`, `journal_document.approve_all`,
 * `calendar.token.rotate`. Типы сущностей шли вперемешку — `User` рядом
 * с «Пользователь», `Organization` рядом с `journal_template`. Детали
 * печатались как `JSON.stringify` одной строкой со скобками и
 * кавычками.
 *
 * Здесь три словаря и одна раскладка деталей. Неизвестный код
 * показываем как есть — это лучше, чем пусто, — но уже без JSON-скобок.
 */

import { redactSensitiveDetails } from "@/lib/audit-redact";
import { completionEntryLabel } from "@/lib/completion-labels";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { getEquipmentTypeLabel } from "@/lib/equipment-type-label";

export type AuditBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

export type AuditActionLabel = {
  label: string;
  variant: AuditBadgeVariant;
};

/** Код действия → русское название и тон бейджа. */
export const AUDIT_ACTION_LABELS: Record<string, AuditActionLabel> = {
  // --- Базовые --------------------------------------------------------
  create: { label: "Создание", variant: "default" },
  created: { label: "Создание", variant: "default" },
  update: { label: "Изменение", variant: "secondary" },
  updated: { label: "Изменение", variant: "secondary" },
  delete: { label: "Удаление", variant: "destructive" },
  login: { label: "Вход", variant: "outline" },
  export: { label: "Экспорт", variant: "outline" },
  approve: { label: "Подтверждение", variant: "default" },
  reject: { label: "Возврат на переделку", variant: "destructive" },
  complete: { label: "Задача завершена", variant: "default" },
  release: { label: "Задача возвращена в общий список", variant: "secondary" },
  skip: { label: "Задача пропущена", variant: "outline" },
  pause: { label: "Пауза", variant: "secondary" },
  start: { label: "Запуск", variant: "outline" },

  // --- Журналы и заполнение --------------------------------------------
  "journal.fill.step": { label: "Шаг инструкции", variant: "outline" },
  "journal.fill.photo": { label: "Фото загружено", variant: "outline" },
  "journal.fill.completed": { label: "Журнал заполнен", variant: "default" },
  "journal.fill.reopened": { label: "Повторное открытие", variant: "secondary" },
  "journal.entry.create": { label: "Запись создана", variant: "default" },
  "journal.entry.update": { label: "Запись изменена", variant: "secondary" },
  "journal.entry.delete": { label: "Запись удалена", variant: "destructive" },
  "journal.document.close": { label: "Журнал закрыт", variant: "secondary" },
  "journal.document.reopen": { label: "Журнал переоткрыт", variant: "outline" },
  "journal.qr_fill": { label: "Заполнение по QR-коду", variant: "outline" },
  "journal.columns_applied": { label: "Колонки журнала обновлены", variant: "secondary" },
  "journal.recreate_documents": { label: "Бланки журнала пересозданы", variant: "secondary" },
  "journal.delete_all_documents": { label: "Все бланки журнала удалены", variant: "destructive" },
  "journal.backfill_verifiers": { label: "Проставлены проверяющие", variant: "secondary" },
  "journal.automation.run": { label: "Автозаполнение выполнено", variant: "outline" },
  "journal.enable": { label: "Журнал включён", variant: "default" },
  "journal_entry.copy": { label: "Запись скопирована", variant: "secondary" },
  "journals.export": { label: "Журналы выгружены", variant: "outline" },
  "journal_document.approve_all": { label: "Бланк подтверждён целиком", variant: "default" },
  "journal_document.approve_cells": { label: "Отметки подтверждены", variant: "default" },
  "journal_document.reject_cells": { label: "Отметки возвращены на переделку", variant: "destructive" },
  "journal_document.reject_document": { label: "Бланк возвращён на переделку", variant: "destructive" },
  "closed_day.override": { label: "Правка закрытого дня", variant: "destructive" },
  apply_auto_fill: { label: "Автозаполнение применено", variant: "secondary" },
  revert_auto_fill: { label: "Автозаполнение отменено", variant: "secondary" },
  fill_from_list: { label: "Заполнено из списка", variant: "secondary" },
  sync_entries: { label: "Записи синхронизированы", variant: "outline" },
  set_control_times: { label: "Время контроля задано", variant: "secondary" },
  attachment: { label: "Вложение", variant: "outline" },
  "attachment.upload": { label: "Фото прикреплено", variant: "outline" },

  // --- Сотрудники и доступ ---------------------------------------------
  add_employee: { label: "Сотрудник добавлен", variant: "default" },
  "employee.self_registered": { label: "Сотрудник зарегистрировался сам", variant: "default" },
  "employee.paired_device": { label: "Устройство сотрудника привязано", variant: "outline" },
  "user.first_login": { label: "Первый вход сотрудника", variant: "outline" },
  "user.role_changed": { label: "Должность изменена", variant: "secondary" },
  "user.deleted": { label: "Сотрудник удалён", variant: "destructive" },
  "user.auto_blocked_expired": { label: "Доступ закрыт: истёк документ", variant: "destructive" },
  "settings.user.archive": { label: "Сотрудник архивирован", variant: "destructive" },
  "settings.user.unarchive": { label: "Сотрудник восстановлен", variant: "default" },
  "staff.bulk-import": { label: "Сотрудники загружены списком", variant: "default" },
  "staff.excel-import": { label: "Сотрудники загружены из Excel", variant: "default" },
  "staff.credentials.issue": { label: "Выданы данные для входа", variant: "secondary" },
  "offboarding.complete": { label: "Увольнение оформлено", variant: "secondary" },
  "security.logout-all": { label: "Выход со всех устройств", variant: "destructive" },
  "impersonate.start": { label: "Вход в кабинет клиента", variant: "outline" },
  "impersonate.stop": { label: "Выход из кабинета клиента", variant: "outline" },
  "badge.enable": { label: "Бейдж включён", variant: "default" },
  "badge.disable": { label: "Бейдж выключен", variant: "secondary" },
  "badge.rotate": { label: "Бейдж перевыпущен", variant: "secondary" },

  // --- Задачи сотрудников -----------------------------------------------
  "task.claim": { label: "Задача взята", variant: "outline" },
  "task.complete": { label: "Задача выполнена", variant: "default" },
  "task.release": { label: "Задача возвращена в общий список", variant: "secondary" },
  "task.skip": { label: "Задача пропущена: «Сегодня не требуется»", variant: "outline" },
  "task.assign": { label: "Задача назначена руководителем", variant: "default" },
  "task.verify.approve": { label: "Задача одобрена", variant: "default" },
  "task.verify.reject": { label: "Задача отправлена на переделку", variant: "destructive" },
  "dashboard.close_day": { label: "День закрыт кнопкой", variant: "secondary" },

  // --- Смены и напоминания ---------------------------------------------
  "shift_watcher.notify_30": { label: "Напоминание за 30 минут", variant: "outline" },
  "shift_watcher.mark_absent": { label: "Отмечен как не вышедший", variant: "destructive" },
  "shift_watcher.staff_check_in_240": { label: "Проверка выхода на смену", variant: "outline" },

  // --- Организация ------------------------------------------------------
  "org.created": { label: "Организация создана", variant: "default" },
  "org.switched": { label: "Переключение организации", variant: "outline" },
  "building.switched": { label: "Переключение точки", variant: "outline" },
  "organization.update": { label: "Реквизиты изменены", variant: "secondary" },
  "organization.settings.update": { label: "Настройки организации изменены", variant: "secondary" },
  "organization.export_downloaded": { label: "Выгрузка организации скачана", variant: "outline" },
  "organization.deletion.request": { label: "Запрошено удаление организации", variant: "destructive" },
  "organization.deletion.cancel": { label: "Удаление организации отменено", variant: "default" },
  "organization.delete_requested": { label: "Запрошено удаление организации", variant: "destructive" },
  "root.organization.delete": { label: "Организация удалена", variant: "destructive" },

  // --- Настройки и интеграции -------------------------------------------
  "settings.tasksflow.connect": { label: "TasksFlow подключён", variant: "default" },
  "settings.tasksflow.disconnect": { label: "TasksFlow отключён", variant: "destructive" },
  "settings.responsibles.update": { label: "Ответственные обновлены", variant: "secondary" },
  "settings.experimental.v2.enable": { label: "Новый дизайн включён", variant: "default" },
  "settings.experimental.v2.disable": { label: "Новый дизайн выключен", variant: "secondary" },
  "calendar.token.rotate": { label: "Ссылка на календарь обновлена", variant: "secondary" },
  "calendar.token.revoke": { label: "Ссылка на календарь отозвана", variant: "destructive" },
  "webhook.create": { label: "Вебхук добавлен", variant: "default" },
  "webhook.update": { label: "Вебхук изменён", variant: "secondary" },
  "webhook.delete": { label: "Вебхук удалён", variant: "destructive" },
  "onboarding.apply-preset": { label: "Применён готовый набор настроек", variant: "default" },
  "settings.journal_scope.update": { label: "Настройки задач журнала изменены", variant: "secondary" },
  "settings.task_flow_mode.update": { label: "Режим распределения задач изменён", variant: "secondary" },
  "equipment.add": { label: "Оборудование добавлено", variant: "default" },
  "equipment.update": { label: "Карточка оборудования изменена", variant: "secondary" },
  "staff.add": { label: "Сотрудник добавлен", variant: "default" },
  "staff.update": { label: "Данные сотрудника изменены", variant: "secondary" },
  ensure_equipment: { label: "Оборудование заведено", variant: "default" },
  save_equipment: { label: "Оборудование сохранено", variant: "secondary" },
  "cleaning.room_scopes.sync": { label: "Помещения уборки обновлены", variant: "secondary" },

  // --- Пошаговые инструкции и гайды --------------------------------------
  "settings.journal-pipelines.seed": { label: "Инструкция создана из колонок", variant: "default" },
  "settings.journal-pipelines.seed-all": { label: "Инструкции созданы пачкой", variant: "default" },
  "settings.journal-pipelines.node.create": { label: "Шаг инструкции добавлен", variant: "default" },
  "settings.journal-pipelines.node.update": { label: "Шаг инструкции обновлён", variant: "secondary" },
  "settings.journal-pipelines.node.delete": { label: "Шаг инструкции удалён", variant: "destructive" },
  "settings.journal-pipelines.node.move": { label: "Шаг инструкции перемещён", variant: "secondary" },
  "settings.journal-pipelines.node.split": { label: "Шаг инструкции разделён", variant: "outline" },
  "settings.journal-pipelines.clear-custom": { label: "Свои шаги очищены", variant: "destructive" },
  "settings.journal-pipelines.clear-all": { label: "Инструкция очищена полностью", variant: "destructive" },
  "settings.journal-guides.node.create": { label: "Шаг подсказки добавлен", variant: "default" },
  "settings.journal-guides.node.update": { label: "Шаг подсказки обновлён", variant: "secondary" },
  "settings.journal-guides.node.delete": { label: "Шаг подсказки удалён", variant: "destructive" },
  "settings.journal-guides.node.move": { label: "Шаг подсказки перемещён", variant: "secondary" },
  "checklist.item.create": { label: "Пункт чек-листа добавлен", variant: "default" },
  "checklist.item.update": { label: "Пункт чек-листа изменён", variant: "secondary" },
  "checklist.item.delete": { label: "Пункт чек-листа удалён", variant: "destructive" },

  // --- Нарушения, потери, идеи -------------------------------------------
  "capa.bulk_close": { label: "Нарушения закрыты пачкой", variant: "secondary" },
  "anomaly.losses_high": { label: "Списания выше обычного", variant: "destructive" },
  "1c_losses_export.sent": { label: "Списания выгружены в 1С", variant: "outline" },
  "predict.compliance_alert": { label: "Предупреждение о готовности", variant: "destructive" },
  "idea.create": { label: "Идея добавлена", variant: "default" },
  "idea.update": { label: "Идея изменена", variant: "secondary" },
  "idea.delete": { label: "Идея удалена", variant: "destructive" },
  "goal.created": { label: "Цель поставлена", variant: "default" },
  "gift.created": { label: "Подарок начислен", variant: "default" },

  // --- Консультант --------------------------------------------------------
  "partner.attached": { label: "Консультант подключён", variant: "default" },
  "partner.detached": { label: "Консультант отключён", variant: "destructive" },
  "partner.access_level": { label: "Уровень доступа консультанта", variant: "secondary" },
  "partner.cabinet_opened": { label: "Консультант открыл кабинет", variant: "outline" },
  "partner.client_org_created": { label: "Организация создана консультантом", variant: "default" },
  "partner.org_updated": { label: "Консультант изменил реквизиты", variant: "secondary" },
  "partner.owner_invited": { label: "Приглашение владельцу", variant: "outline" },
  "partner.admin_updated": { label: "Настройки консультанта изменены", variant: "secondary" },

  // --- Деньги и подписка --------------------------------------------------
  "invoice.mark-paid": { label: "Счёт отмечен оплаченным", variant: "default" },
  "invoice.cancel": { label: "Счёт отменён", variant: "destructive" },
  "billing.recurring.disable": { label: "Автопродление выключено", variant: "secondary" },
  "subscription.auto_paused": { label: "Подписка приостановлена", variant: "destructive" },
  "subscription.cancelled": { label: "Подписка отменена", variant: "destructive" },
  "subscription.resumed": { label: "Подписка возобновлена", variant: "default" },
  "plan.auto_upgraded": { label: "Тариф повышен автоматически", variant: "secondary" },

  // --- Резервные копии ----------------------------------------------------
  "yandex_backup.success": { label: "Резервная копия создана", variant: "default" },
  "yandex_backup.manual": { label: "Резервная копия вручную", variant: "outline" },
  "yandex_backup.failed": { label: "Резервная копия не создалась", variant: "destructive" },

  // --- Прочее -------------------------------------------------------------
  "nps.recommend": { label: "Рекомендация WeSetup коллеге", variant: "outline" },
  "ai_assistant.action": { label: "Действие помощника", variant: "outline" },
  "closing-document.refresh-buyer": { label: "Реквизиты покупателя обновлены", variant: "secondary" },
  "tasksflow.cleanup_pending": { label: "Очистка задач TasksFlow", variant: "secondary" },
  "tasksflow.bulk_assign.force_wipe": { label: "Массовое переназначение задач", variant: "destructive" },
};

/**
 * Типы сущностей. Ключи приводим к нижнему регистру при поиске — в базе
 * лежат и `User`, и `user`, и `journal_template`.
 */
const ENTITY_LABELS_LOWER: Record<string, string> = {
  area: "Цех",
  equipment: "Оборудование",
  user: "Сотрудник",
  пользователь: "Сотрудник",
  сотрудник: "Сотрудник",
  organization: "Организация",
  организация: "Организация",
  journal_entry: "Запись журнала",
  journal_entry_attachment: "Фото к записи",
  journal_task: "Задача",
  journal_task_claim: "Задача",
  journal_document: "Бланк журнала",
  journal_document_entry: "Отметка в бланке",
  journal_template: "Журнал",
  journal: "Журнал",
  product: "Продукт",
  building: "Точка",
  room: "Помещение",
  shift: "Смена",
  work_shift: "Смена",
  capa_ticket: "Нарушение",
  capa: "Нарушение",
  tasksflowintegration: "Интеграция TasksFlow",
  manager_scope: "Видимость руководителя",
  position: "Должность",
  job_position: "Должность",
  journalpipelinetemplate: "Шаблон инструкции",
  journalpipelinenode: "Шаг инструкции",
  journalguidetemplate: "Шаблон подсказки",
  journalguidenode: "Шаг подсказки",
  webhook: "Вебхук",
  invoice: "Счёт",
  subscription: "Подписка",
  idea: "Идея",
  partner: "Консультант",
  backup: "Резервная копия",
  settings: "Настройки",
  npsresponse: "Опрос «Посоветуете WeSetup коллегам?»",
};

/** Список для выпадающего фильтра: код сущности → название. */
export const AUDIT_ENTITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "user", label: "Сотрудник" },
  { value: "organization", label: "Организация" },
  { value: "journal_template", label: "Журнал" },
  { value: "journal_document", label: "Бланк журнала" },
  { value: "journal_entry", label: "Запись журнала" },
  { value: "journal_task", label: "Задача" },
  { value: "equipment", label: "Оборудование" },
  { value: "area", label: "Цех" },
  { value: "product", label: "Продукт" },
  { value: "position", label: "Должность" },
  { value: "TasksFlowIntegration", label: "Интеграция TasksFlow" },
];

/** Русский тип сущности. Неизвестный — как есть. */
export function auditEntityLabel(entity: string | null | undefined): string {
  const raw = (entity ?? "").trim();
  if (!raw) return "—";
  return ENTITY_LABELS_LOWER[raw.toLowerCase()] ?? raw;
}

/** Русское название действия. Неизвестный код — как есть, без JSON. */
export function auditActionLabel(action: string): AuditActionLabel {
  return (
    AUDIT_ACTION_LABELS[action] ?? { label: action, variant: "outline" as const }
  );
}

/** Подписи технических ключей в деталях — поверх подписей полей журналов. */
const DETAIL_KEY_LABELS: Record<string, string> = {
  count: "Количество",
  removed: "Удалено",
  created: "Создано",
  createdCount: "Создано",
  updated: "Изменено",
  total: "Всего",
  totalSteps: "Шагов всего",
  stepIndex: "Номер шага",
  stepTitle: "Шаг",
  stepsConfirmed: "Подтверждено шагов",
  journalCode: "Журнал",
  journalLabel: "Журнал",
  templateCode: "Журнал",
  documentId: "Бланк",
  documentTitle: "Бланк",
  entryId: "Запись",
  filename: "Файл",
  size: "Размер",
  url: "Ссылка",
  title: "Название",
  name: "Название",
  email: "Почта",
  phone: "Телефон",
  role: "Должность",
  from: "Было",
  to: "Стало",
  before: "Было",
  after: "Стало",
  changed: "Изменено",
  dateKey: "Дата",
  date: "Дата",
  scopeLabel: "Задача",
  task: "Задача",
  assignee: "Исполнитель",
  employee: "Сотрудник",
  parentId: "Родительский шаг",
  reason: "Причина",
  comment: "Комментарий",
  ip: "IP-адрес",
  userAgent: "Устройство",
  skippedExisting: "Уже было",
  skippedNoFields: "Без колонок",
  newPartNumber: "Номер части",
  msSinceFormOpen: "Время от открытия формы",
  totalDurationMs: "Общая длительность",
  // Способ и итоги массовых действий
  via: "Способ",
  journalsGranted: "Выдано журналов",
  filledCells: "Заполнено отметок",
  totalFilled: "Заполнено отметок",
  journalsFilled: "Журналов заполнено",
  journals: "Журналы",
  documentsCreated: "Создано бланков",
  documentsUpdated: "Обновлено бланков",
  processed: "Журналов обработано",
  upTo: "По дату",
  today: "Сегодня",
  // Колонки журнала
  hidden: "Скрытые колонки",
  labels: "Подписи колонок",
  applyTo: "Применено",
  // Настройки задач
  taskFlowMode: "Режим задач",
  taskScope: "Тип задачи",
  allowNoEvents: "Кнопка «Не требуется сегодня»",
  noEventsReasons: "Причины пропуска",
  allowFreeTextReason: "Своя причина",
  // Оборудование
  equipmentName: "Оборудование",
  type: "Тип",
  serialNumber: "Серийный номер",
  tempMin: "Норма от, °C",
  tempMax: "Норма до, °C",
  tuyaDeviceId: "Датчик",
  // Организация
  journalShortName: "Название для журналов",
  inn: "ИНН",
  address: "Адрес",
  timezone: "Часовой пояс",
  locationsCount: "Число точек",
  ownershipKind: "Форма собственности",
  locale: "Язык",
  brandColor: "Цвет бренда",
  logoUrl: "Логотип",
  shiftEndHour: "Конец смены, час",
  lockPastDayEdits: "Запрет правки прошлых дней",
  requireAdminForJournalEdit: "Правка журналов только руководителем",
  accountantEmail: "Почта бухгалтера",
  subscriptionPlan: "Тариф",
  subscriptionEnd: "Подписка до",
  // Рекомендация коллеге из опроса NPS
  colleagueEmail: "Почта коллеги",
  npsScore: "Оценка",
  delivery: "Доставка",
};

/**
 * Служебные ссылки на записи в базе: человеку ничего не говорят, а
 * название, если оно есть, лежит в соседнем поле.
 */
const HIDDEN_DETAIL_KEYS = new Set([
  "joinTokenId",
  "partnerId",
  "claimId",
  "userId",
  "organizationId",
  "areaId",
  "templateId",
  "documentId",
  "entryId",
  "parentId",
]);

/** Значения-перечисления по ключу → по-русски. */
const DETAIL_VALUE_LABELS: Record<string, Record<string, string>> = {
  via: {
    // Журнал включён (journal.enable, lib/blank-signup.ts).
    "blank-qr-signup": "регистрация по QR со скачанного шаблона",
    "blank-qr": "«Включить журнал» после QR со скачанного шаблона",
    "journal-page": "кнопка «Включить журнал»",
    qr_join_token: "QR-приглашение",
    "dashboard.close_day": "кнопка «Закрыть день»",
    "dashboard.catch_up": "«Догнать пропуски»",
    "tasksflow-supervisor": "из TasksFlow",
  },
  applyTo: {
    all: "ко всем бланкам",
    "active-any": "к действующим бланкам",
    "new-only": "только к новым бланкам",
  },
  taskFlowMode: {
    race: "Гонка",
    shared: "Свободно",
    manual: "Только руководитель назначает",
  },
  taskScope: { personal: "личная", shared: "общая задача смены" },
  delivery: { sent: "письмо отправлено", logged: "почта не настроена — письмо в логе сервера" },
  role: {
    owner: "владелец",
    manager: "руководитель",
    head_chef: "шеф-повар",
    technologist: "технолог",
    cook: "повар",
    waiter: "официант",
    operator: "сотрудник",
  },
};

/** Ключи, значения которых — сами имена полей (их тоже переводим). */
const FIELD_LIST_KEYS = new Set(["hidden", "changed", "fields"]);

/** Ключи, где значение — код журнала; показываем название журнала. */
const JOURNAL_CODE_KEYS = new Set(["journalCode", "templateCode", "journals"]);

const JOURNAL_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name])
);

/** Похоже на cuid — служебный id записи, не для человека. */
export function looksLikeRecordId(value: string): boolean {
  return /^c[a-z0-9]{20,}$/.test(value.trim());
}

/** Название журнала по коду; незнакомый код — как есть. */
export function auditJournalName(code: string | null | undefined): string {
  const value = (code ?? "").trim();
  return JOURNAL_NAME_BY_CODE[value] ?? value;
}

/** Подпись ключа в деталях: свои → общие подписи полей → сам ключ. */
export function auditDetailLabel(key: string): string {
  return DETAIL_KEY_LABELS[key] ?? completionEntryLabel(key);
}

export type AuditDetailPair = { key: string; label: string; value: string };

/**
 * Детали события парами «Подпись: значение».
 *
 * Никакого `JSON.stringify` со скобками: вложенные объекты и массивы
 * либо разворачиваются в понятные значения, либо не показываются.
 * Служебные id (cuid) не показываем, коды журналов подменяем названием,
 * перечисления («qr_join_token», «all») — русскими словами.
 * Чувствительные ключи (пароли, токены) по-прежнему прячет
 * `redactSensitiveDetails`.
 */
export function auditDetailPairs(
  details: Record<string, unknown> | null | undefined,
  limit = 8
): AuditDetailPair[] {
  if (!details) return [];
  const safe = redactSensitiveDetails(details) as Record<string, unknown>;
  const out: AuditDetailPair[] = [];
  for (const [key, value] of Object.entries(safe)) {
    if (out.length >= limit) break;
    if (HIDDEN_DETAIL_KEYS.has(key)) continue;
    const text = formatDetailValue(value, key);
    if (text === null) continue;
    out.push({ key, label: auditDetailLabel(key), value: text });
  }
  return out;
}

function formatScalar(value: string | number, key?: string): string | null {
  if (typeof value === "number") return String(value);
  const text = value.trim();
  if (text === "") return null;
  if (looksLikeRecordId(text)) return null;
  if (key) {
    const enumLabel = DETAIL_VALUE_LABELS[key]?.[text];
    if (enumLabel) return enumLabel;
    if (JOURNAL_CODE_KEYS.has(key) && JOURNAL_NAME_BY_CODE[text]) {
      return JOURNAL_NAME_BY_CODE[text];
    }
    if (FIELD_LIST_KEYS.has(key)) return auditDetailLabel(text);
    if (key === "type") return getEquipmentTypeLabel(text) || text;
  }
  return text;
}

function formatDetailValue(value: unknown, key?: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number" || typeof value === "string") {
    return formatScalar(value, key);
  }
  if (Array.isArray(value)) {
    // Массив простых значений — перечисляем; массив объектов не печатаем:
    // «[object Object]» человеку ничего не сообщает.
    const items = value
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map((v) => formatScalar(v, key))
      .filter((v): v is string => v !== null);
    if (items.length === 0) {
      const objects = value.filter((v) => v !== null && typeof v === "object").length;
      return objects > 0 ? `${objects} шт.` : null;
    }
    const head = items.slice(0, 5).join(", ");
    return items.length > 5 ? `${head} и ещё ${items.length - 5}` : head;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    // «Было → стало» одной строкой: { from, to }.
    if (keys.length > 0 && keys.every((k) => k === "from" || k === "to")) {
      const from = formatDetailValue(record.from, key) ?? "—";
      const to = formatDetailValue(record.to, key) ?? "—";
      return `${from} → ${to}`;
    }
    const nested = Object.entries(record)
      .filter(([k]) => !HIDDEN_DETAIL_KEYS.has(k))
      .map(([k, v]) => {
        const text = formatDetailValue(v, k);
        return text === null ? null : `${auditDetailLabel(k)}: ${text}`;
      })
      .filter((v): v is string => v !== null);
    return nested.length > 0 ? nested.slice(0, 4).join("; ") : null;
  }
  return null;
}
