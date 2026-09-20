"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useRegisterRefresh } from "../_components/refresh-provider";
import { ArrowLeft, Loader2 } from "lucide-react";

type AuditLog = {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export default function MiniAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mini/audit", { cache: "no-store" });
      // Раньше любой отказ выглядел как «не удалось загрузить»: сотрудник
      // без прав видел красную ошибку и думал, что приложение сломалось.
      if (res.status === 401) {
        throw new Error("Сессия закончилась. Откройте приложение заново.");
      }
      if (res.status === 403) {
        throw new Error(
          "Журнал действий видят владелец и заведующая. Попросите их показать нужную запись."
        );
      }
      if (!res.ok) {
        throw new Error(
          "Не удалось загрузить журнал действий. Проверьте связь и нажмите «Повторить»."
        );
      }
      const data = await res.json();
      setLogs(data.logs ?? []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Не удалось загрузить журнал действий."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRegisterRefresh(load);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href="/mini"
        className="-my-2 min-h-9 inline-flex items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>

      <header className="px-1">
        <h1
          className="text-[20px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Журнал действий
        </h1>
        <p
          className="mt-0.5 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Кто и что менял в заведении — последние 100 событий. Нужен, когда
          надо понять, кто заполнил или исправил запись.
        </p>
      </header>

      {loading ? (
        <div
          className="flex items-center justify-center text-[14px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <Loader2
            className="mr-2 size-4 animate-spin"
            style={{ color: "var(--mini-lime)" }}
          />
          Загружаем…
        </div>
      ) : error ? (
        <div
          className="rounded-2xl px-4 py-3.5 text-[13px] leading-5"
          style={{
            background: "var(--mini-crimson-soft)",
            border: "1px solid var(--mini-divider)",
            color: "var(--mini-crimson)",
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="mini-press mt-3 block rounded-xl px-4 py-2 text-[13px] font-medium"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            Повторить
          </button>
        </div>
      ) : logs.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-6 text-center text-[14px]"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px dashed var(--mini-divider-strong)",
            color: "var(--mini-text-muted)",
          }}
        >
          Пока нет записей.
        </div>
      ) : (
        <section className="space-y-2">
          {logs.map((log) => {
            const dt = new Date(log.createdAt).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
            const actionLabel = formatAction(log.action);
            const details = readableDetails(log.details);
            return (
              <div
                key={log.id}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: "var(--mini-card-solid-bg)",
                  border: "1px solid var(--mini-divider)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[12px] font-medium"
                    style={{ color: "var(--mini-text-muted)" }}
                  >
                    {actionLabel}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--mini-text-faint)" }}
                  >
                    {dt}
                  </span>
                </div>
                <div
                  className="mt-1 text-[13px]"
                  style={{ color: "var(--mini-text)" }}
                >
                  {log.userName ?? "Неизвестно кто"} · {formatEntity(log.entity)}
                </div>
                {/* Раньше здесь печатался сырой JSON, обрезанный на 120-м
                    символе посреди слова. Теперь — только те поля, которые
                    человек может прочитать. */}
                {details.length > 0 ? (
                  <div
                    className="mt-1.5 space-y-0.5 text-[12px]"
                    style={{ color: "var(--mini-text-muted)" }}
                  >
                    {details.map((d) => (
                      <div key={d.label}>
                        {d.label}: <span style={{ color: "var(--mini-text)" }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  login: "Вход в кабинет",
  export: "Выгрузка",
  "journal_entry.create": "Создание записи",
  "journal_entry.copy": "Копирование записей",
  "journal_entry.delete": "Удаление записи",
  "journal.entry.create": "Создание записи",
  "journal.entry.update": "Изменение записи",
  "journal.entry.delete": "Удаление записи",
  "journal.qr_fill": "Заполнение по QR-коду",
  "journal.fill.step": "Шаг заполнения",
  "journal.fill.photo": "Загрузка фото",
  "journal.fill.completed": "Журнал заполнен",
  "journal.fill.reopened": "Повторное открытие журнала",
  "journal.document.close": "Журнал закрыт",
  "journal.document.reopen": "Журнал переоткрыт",
  "journal.columns_applied": "Настройка колонок журнала",
  "journal.responsibles_updated": "Смена ответственных",
  "attachment.upload": "Загрузка файла",
  "staff.add": "Добавление сотрудника",
  "staff.update": "Изменение сотрудника",
  "staff.archived": "Сотрудник в архиве",
  "staff.restored": "Сотрудник возвращён из архива",
  "equipment.add": "Добавление оборудования",
  "equipment.update": "Изменение оборудования",
  "partner.attached": "Консультант подключён",
  "partner.detached": "Консультант отключён",
  "partner.org_updated": "Консультант изменил данные заведения",
  "partner.org_created": "Заведение создано консультантом",
  "tasksflow.connected": "Задачи подключены",
  "tasksflow.disconnected": "Задачи отключены",
};

/** Хвост кода действия → русский глагол. Страховка для новых событий. */
const ACTION_VERBS: Record<string, string> = {
  add: "Добавление",
  added: "Добавление",
  create: "Создание",
  created: "Создание",
  update: "Изменение",
  updated: "Изменение",
  delete: "Удаление",
  deleted: "Удаление",
  removed: "Удаление",
  copy: "Копирование",
  upload: "Загрузка",
  export: "Выгрузка",
  applied: "Применение настроек",
  close: "Закрытие",
  closed: "Закрытие",
  reopen: "Переоткрытие",
  archived: "Перенос в архив",
  restored: "Возврат из архива",
  attached: "Подключение",
  detached: "Отключение",
  connected: "Подключение",
  disconnected: "Отключение",
  invited: "Приглашение",
  verified: "Подтверждение",
  qr_fill: "Заполнение по QR-коду",
};

function formatAction(action: string): string {
  const exact = ACTION_LABELS[action];
  if (exact) return exact;
  const tail = action.split(".").slice(1).join(".");
  return ACTION_VERBS[tail] ?? ACTION_VERBS[action] ?? "Изменение данных";
}

const ENTITY_LABELS: Record<string, string> = {
  area: "Цех",
  room: "Помещение",
  equipment: "Оборудование",
  user: "Сотрудник",
  staff: "Сотрудник",
  journal_entry: "Запись журнала",
  journal_document: "Документ журнала",
  journal_template: "Шаблон журнала",
  journal_task: "Задача",
  product: "Продукт",
  organization: "Заведение",
  position: "Должность",
  attachment: "Файл",
  manager_scope: "Видимость руководителя",
  tasksflowintegration: "Подключение задач",
};

function formatEntity(entity: string): string {
  const key = entity.trim().toLowerCase();
  return ENTITY_LABELS[key] ?? entity;
}

const DETAIL_LABELS: Record<string, string> = {
  objectname: "Объект",
  name: "Название",
  title: "Название",
  datekey: "Дата",
  date: "Дата",
  slot: "Время",
  temperature: "Температура",
  temp: "Температура",
  humidity: "Влажность",
  outofrange: "Вне нормы",
  reason: "Причина",
  comment: "Комментарий",
  note: "Заметка",
  documentsupdated: "Изменено документов",
  count: "Количество",
  journalname: "Журнал",
  journal: "Журнал",
  status: "Статус",
  role: "Роль",
  phone: "Телефон",
  email: "Почта",
};

/**
 * Из служебного JSON оставляем только то, что можно прочитать вслух:
 * идентификаторы, флаги и вложенные структуры человеку не нужны.
 */
function readableDetails(
  details: Record<string, unknown> | null
): Array<{ label: string; value: string }> {
  if (!details || typeof details !== "object") return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const [rawKey, rawValue] of Object.entries(details)) {
    if (out.length >= 4) break;
    const key = rawKey.toLowerCase();
    if (key.endsWith("id") || key.endsWith("ids") || key.endsWith("key")) {
      if (key !== "datekey") continue;
    }
    const label = DETAIL_LABELS[key];
    if (!label) continue;
    const value = formatDetailValue(key, rawValue);
    if (value) out.push({ label, value });
  }
  return out;
}

function formatDetailValue(key: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  // Даты приходят машинным «2026-09-18» — показываем по-русски.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso && (key === "datekey" || key === "date")) {
    return `${iso[3]}.${iso[2]}.${iso[1]}`;
  }
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}
