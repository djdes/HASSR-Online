"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Bell, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { MiniSheet } from "../_components/mini-sheet";
import {
  MiniSearchField,
  SEARCH_WORTH_IT_FROM,
} from "../_components/mini-search-field";
import { filterAndRank } from "../_lib/list-search";
import { useRegisterRefresh } from "../_components/refresh-provider";

type Employee = {
  id: string;
  name: string;
  phone: string | null;
  positionTitle: string | null;
  telegramLinked: boolean;
  isActive: boolean;
};

type Position = {
  id: string;
  name: string;
  categoryKey: string;
};

type StaffData = {
  employees: Employee[];
  positions: Position[];
};

type LocalState =
  | { kind: "loading" }
  // `denied` — не поломка, а «вам сюда не надо»: показываем спокойно,
  // без красного слова «Ошибка», которое пугает рядового сотрудника.
  | { kind: "denied"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: StaffData }
  | { kind: "adding" };

export default function MiniStaffPage() {
  const { status } = useSession();
  const [state, setState] = useState<LocalState>({ kind: "loading" });
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [phone, setPhone] = useState("");
  const [notifyStatus, setNotifyStatus] = useState<Record<string, string>>({});
  // Приглашение в Telegram: тот же эндпоинт, что на сайте в
  // `/settings/users` — в Mini App его просто не было, и «Нет TG» было
  // тупиком (П-3).
  const [invite, setInvite] = useState<
    | { kind: "loading"; employee: Employee }
    | { kind: "ready"; employee: Employee; url: string; qr: string | null }
    | { kind: "error"; employee: Employee; message: string }
    | null
  >(null);
  // Per-employee timer-id'ы для clearTimeout. Раньше setTimeout не очищался
  // при unmount → setState на dead component + утечка. Pass-3 review #8.
  const notifyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  useEffect(() => {
    if (status !== "authenticated") return;
    loadData();
  }, [status]);

  // Потянули вниз — перечитываем штат.
  useRegisterRefresh(() => loadData());

  useEffect(() => {
    // Clear все pending-timer'ы при unmount компонента.
    // Снимок ref'a в effect — линтер требует чтобы cleanup не читал
    // ref.current напрямую (значение может измениться к моменту cleanup).
    const timers = notifyTimersRef.current;
    return () => {
      for (const t of timers.values()) {
        clearTimeout(t);
      }
      timers.clear();
    };
  }, []);

  async function loadData() {
    try {
      const resp = await fetch("/api/mini/staff", { cache: "no-store" });
      if (resp.status === 403) {
        setState({
          kind: "denied",
          message:
            "Список сотрудников ведёт руководитель. Если нужно что-то поправить в вашей карточке — телефон, должность, доступ к журналам — попросите его.",
        });
        return;
      }
      if (!resp.ok) {
        if (resp.status === 401) {
          throw new Error("Сессия закончилась. Откройте приложение заново.");
        }
        const body = (await resp.json().catch(() => ({ error: "" }))) as {
          error?: string;
        };
        throw new Error(
          body.error ||
            "Не удалось загрузить список сотрудников. Проверьте связь и нажмите «Повторить»."
        );
      }
      const data = (await resp.json()) as StaffData;
      setState({ kind: "ready", data });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Не удалось загрузить список сотрудников.",
      });
    }
  }

  async function handleInvite(emp: Employee) {
    setInvite({ kind: "loading", employee: emp });
    try {
      const resp = await fetch(`/api/staff/${emp.id}/invite-tg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invite" }),
      });
      const body = (await resp.json().catch(() => ({}))) as {
        error?: string;
        inviteUrl?: string;
        qrPngDataUrl?: string;
      };
      if (!resp.ok || !body.inviteUrl) {
        throw new Error(
          body.error ||
            "Не удалось создать приглашение. Попробуйте ещё раз чуть позже."
        );
      }
      setInvite({
        kind: "ready",
        employee: emp,
        url: body.inviteUrl,
        qr: body.qrPngDataUrl ?? null,
      });
    } catch (err) {
      setInvite({
        kind: "error",
        employee: emp,
        message:
          err instanceof Error && err.message
            ? err.message
            : "Не удалось создать приглашение.",
      });
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (formLoading) return; // mutex: защита от двойного submit'а
    setFormError(null);
    setFormLoading(true);
    const fd = new FormData(e.currentTarget);
    const rawPhone = String(fd.get("phone") ?? "").trim();
    // Нормализация телефона перед отправкой:
    //  - принимаем +7…, 7…, 8…, и просто 10-значный (российский номер
    //    без префикса). Сервер ожидает точную форму — подгоняем тут,
    //    чтобы пользователь не получал cryptic 400 при «8 985…».
    //  - удаляем все нецифровые символы, ведущий +.
    const digits = rawPhone.replace(/[^\d]/g, "");
    let normalized = digits;
    if (normalized.length === 11 && (normalized.startsWith("7") || normalized.startsWith("8"))) {
      normalized = "7" + normalized.slice(1);
    } else if (normalized.length === 10) {
      normalized = "7" + normalized;
    }
    if (normalized.length !== 11 || !normalized.startsWith("7")) {
      setFormError(
        "Телефон должен быть российский (11 цифр, начинается с 7 или 8)"
      );
      setFormLoading(false);
      return;
    }
    const body = {
      jobPositionId: fd.get("position") as string,
      fullName: String(fd.get("name") ?? "").trim(),
      phone: "+" + normalized,
    };
    try {
      const resp = await fetch("/api/mini/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({ error: "" }))) as {
          error?: string;
        };
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setShowForm(false);
      setPhone("");
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setFormLoading(false);
    }
  }

  if (status !== "authenticated" || state.kind === "loading") {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[14px]"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <Loader2
          className="mr-2 size-4 animate-spin"
          style={{ color: "var(--mini-lime)" }}
        />
        Загружаем…
      </div>
    );
  }

  if (state.kind === "denied") {
    return (
      <div className="flex flex-1 flex-col gap-3 pt-6">
        <div
          className="rounded-2xl px-4 py-4"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <p
            className="text-[15px] font-medium"
            style={{ color: "var(--mini-text)" }}
          >
            Раздел для руководителя
          </p>
          <p
            className="mt-1.5 text-[14px] leading-5"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {state.message}
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p
          className="text-[14px] leading-5"
          style={{ color: "var(--mini-crimson)" }}
        >
          {state.message}
        </p>
        <button
          onClick={() => loadData()}
          className="mt-1 rounded-xl px-4 py-2 text-sm font-medium"
          style={{
            background: "var(--mini-lime)",
            color: "var(--mini-primary-contrast)",
          }}
        >
          Повторить
        </button>
      </div>
    );
  }

  if (state.kind !== "ready") {
    return null;
  }

  const { employees, positions } = state.data;
  const shownEmployees = filterAndRank(employees, query, (emp) => [
    emp.name,
    emp.positionTitle,
    emp.phone,
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header className="flex items-center justify-between pt-2">
        <h1
          className="text-[22px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Сотрудники
        </h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-[13px] font-medium"
          style={{
            background: "var(--mini-lime)",
            color: "var(--mini-primary-contrast)",
            boxShadow: "var(--mini-primary-shadow)",
          }}
        >
          {showForm ? (
            "Отмена"
          ) : (
            <>
              <UserPlus className="size-4" />
              Добавить
            </>
          )}
        </button>
      </header>

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-2xl p-4"
          style={{
            background: "var(--mini-card-solid-bg)",
            border: "1px solid var(--mini-divider)",
          }}
        >
          <div>
            <label
              className="block text-[13px] font-medium"
              style={{ color: "var(--mini-text)" }}
            >
              Должность
            </label>
            <select
              name="position"
              required
              className="mt-1 w-full rounded-xl px-3 py-2 text-[14px] focus:outline-none"
              style={{
                background: "var(--mini-surface-2)",
                border: "1px solid var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            >
              <option value="">Выберите…</option>
              {positions.map((p: Position) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="block text-[13px] font-medium"
              style={{ color: "var(--mini-text)" }}
            >
              ФИО
            </label>
            <input
              name="name"
              required
              placeholder="Иванов Иван Иванович"
              className="mt-1 w-full rounded-xl px-3 py-2 text-[14px] focus:outline-none"
              style={{
                background: "var(--mini-surface-2)",
                border: "1px solid var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            />
          </div>
          <div>
            <label
              className="block text-[13px] font-medium"
              style={{ color: "var(--mini-text)" }}
            >
              Телефон
            </label>
            <input
              name="phone"
              required
              {...phoneInputProps(phone, setPhone)}
              placeholder={RU_PHONE_PLACEHOLDER}
              className="mt-1 w-full rounded-xl px-3 py-2 text-[14px] focus:outline-none"
              style={{
                background: "var(--mini-surface-2)",
                border: "1px solid var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            />
          </div>
          {formError ? (
            <p className="text-[13px]" style={{ color: "var(--mini-crimson)" }}>
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={formLoading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-medium disabled:opacity-50"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            {formLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Сохраняем…
              </>
            ) : (
              "Добавить сотрудника"
            )}
          </button>
        </form>
      ) : null}

      {employees.length >= SEARCH_WORTH_IT_FROM ? (
        <MiniSearchField
          value={query}
          onChange={setQuery}
          placeholder="Имя, должность или телефон"
          resultLabel={
            query.trim()
              ? `Найдено ${shownEmployees.length} из ${employees.length}`
              : undefined
          }
        />
      ) : null}

      <section className="space-y-2">
        {employees.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-4 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Пока нет сотрудников.
          </div>
        ) : shownEmployees.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-4 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Никто не нашёлся по «{query.trim()}».
          </div>
        ) : (
          shownEmployees.map((emp: Employee) => (
            <div
              key={emp.id}
              className="flex items-center justify-between rounded-2xl px-4 py-3"
              style={{
                background: "var(--mini-card-solid-bg)",
                border: "1px solid var(--mini-divider)",
              }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[15px] font-medium"
                  style={{ color: "var(--mini-text)" }}
                >
                  {emp.name}
                </p>
                {/* Раньше здесь стоял голый прочерк и телефон в одну
                    строку: на узком экране строка обрезалась посередине,
                    и не понять, то ли должности нет, то ли не догрузилось. */}
                <p
                  className="truncate text-[13px]"
                  style={{ color: "var(--mini-text-muted)" }}
                >
                  {emp.positionTitle || "Без должности"}
                </p>
                <p
                  className="truncate text-[12px]"
                  style={{
                    color: emp.phone
                      ? "var(--mini-text-faint)"
                      : "var(--mini-crimson)",
                  }}
                >
                  {/* Телефон — ключ связки с задачами (П-8): без него
                      сотрудник не свяжется с аккаунтом в TasksFlow. */}
                  {emp.phone || "Нет телефона — добавьте его"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {emp.telegramLinked ? (
                  <>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        background: "var(--mini-sage-soft)",
                        color: "var(--mini-sage)",
                      }}
                    >
                      TG
                    </span>
                    <button
                      onClick={async () => {
                        setNotifyStatus((s) => ({ ...s, [emp.id]: "sending" }));
                        try {
                          const res = await fetch("/api/mini/notify", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              userId: emp.id,
                              message: `Напоминание от руководителя: проверьте заполнение журналов.`,
                              actionLabel: "Открыть Mini App",
                              actionUrl: `${window.location.origin}/mini`,
                            }),
                          });
                          if (res.ok) {
                            setNotifyStatus((s) => ({ ...s, [emp.id]: "sent" }));
                            toast.success(`Напоминание отправлено: ${emp.name}`);
                          } else {
                            setNotifyStatus((s) => ({ ...s, [emp.id]: "error" }));
                            // Раньше ошибка была видна только как значок
                            // колокольчика, который просто не поменялся.
                            toast.error(
                              "Не удалось отправить напоминание. Попробуйте ещё раз."
                            );
                          }
                        } catch {
                          setNotifyStatus((s) => ({ ...s, [emp.id]: "error" }));
                          toast.error(
                            "Нет связи с сервером — напоминание не ушло."
                          );
                        }
                        // Очищаем предыдущий timer этого сотрудника
                        // (повторный клик до 3с на ту же кнопку) и
                        // запускаем новый.
                        const existing = notifyTimersRef.current.get(emp.id);
                        if (existing) clearTimeout(existing);
                        const timerId = setTimeout(() => {
                          notifyTimersRef.current.delete(emp.id);
                          setNotifyStatus((s) => {
                            const next = { ...s };
                            delete next[emp.id];
                            return next;
                          });
                        }, 3000);
                        notifyTimersRef.current.set(emp.id, timerId);
                      }}
                      disabled={notifyStatus[emp.id] === "sending"}
                      className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-xl px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                      style={{
                        background: "var(--mini-lime-soft)",
                        color: "var(--mini-lime)",
                      }}
                    >
                      {notifyStatus[emp.id] === "sending"
                        ? "…"
                        : notifyStatus[emp.id] === "sent"
                          ? "✓"
                          : <Bell className="size-3.5" />}
                    </button>
                  </>
                ) : (
                  /* «Нет TG» был тупиком: непонятно и ничего не сделать.
                     Теперь это кнопка, которая выдаёт ссылку-приглашение. */
                  <button
                    type="button"
                    onClick={() => void handleInvite(emp)}
                    className="mini-press rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      background: "var(--mini-lime-soft)",
                      color: "var(--mini-lime)",
                    }}
                  >
                    Пригласить
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <MiniSheet
        open={invite !== null}
        onClose={() => setInvite(null)}
        title="Приглашение в Telegram"
        subtitle={invite?.employee.name}
      >
        {invite?.kind === "loading" ? (
          <div
            className="flex items-center justify-center gap-2 px-3 py-8 text-[14px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            <Loader2
              className="size-4 animate-spin"
              style={{ color: "var(--mini-lime)" }}
            />
            Готовим ссылку…
          </div>
        ) : invite?.kind === "error" ? (
          <div className="px-3 py-4">
            <p
              className="text-[14px] leading-5"
              style={{ color: "var(--mini-crimson)" }}
            >
              {invite.message}
            </p>
            <button
              type="button"
              onClick={() => void handleInvite(invite.employee)}
              className="mini-press mt-3 rounded-xl px-4 py-2 text-[13px] font-medium"
              style={{
                background: "var(--mini-lime)",
                color: "var(--mini-primary-contrast)",
              }}
            >
              Повторить
            </button>
          </div>
        ) : invite?.kind === "ready" ? (
          <div className="space-y-3 px-3 py-3">
            <p
              className="text-[13px] leading-5"
              style={{ color: "var(--mini-text-muted)" }}
            >
              Отправьте сотруднику эту ссылку или покажите ему код с экрана.
              Он откроет бота, и приложение само его узнает — пароль не нужен.
              Ссылка работает 7 дней.
            </p>
            {invite.qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data:URL с сервера, оптимизация не нужна
              <img
                src={invite.qr}
                alt="Код для входа"
                className="mx-auto block size-44 rounded-2xl"
                style={{ background: "#ffffff", padding: 8 }}
              />
            ) : null}
            <p
              className="mini-mono break-all rounded-xl px-3 py-2 text-[12px]"
              style={{
                background: "var(--mini-surface-2)",
                color: "var(--mini-text-muted)",
              }}
            >
              {invite.url}
            </p>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invite.url);
                  toast.success("Ссылка скопирована");
                } catch {
                  toast.error(
                    "Браузер не дал скопировать — выделите ссылку вручную."
                  );
                }
              }}
              className="mini-btn-primary mini-press flex h-12 w-full items-center justify-center text-[15px]"
            >
              Скопировать ссылку
            </button>
          </div>
        ) : null}
      </MiniSheet>
    </div>
  );
}
