"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";

type Position = { id: string; name: string; categoryKey: string };

type Props = {
  token: string;
  positions: Position[];
  suggestedJobPositionId: string | null;
};

export function JoinForm({ token, positions, suggestedJobPositionId }: Props) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+7");
  // Должность приглашения — если её указал руководитель. Иначе пусто:
  // раньше подставлялась первая строка списка («Управляющий»), и повар,
  // не вчитавшись, регистрировался руководителем.
  const lockedPositionId =
    suggestedJobPositionId &&
    positions.some((p) => p.id === suggestedJobPositionId)
      ? suggestedJobPositionId
      : null;
  const [jobPositionId, setJobPositionId] = useState(lockedPositionId ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const mgmt = positions.filter((p) => p.categoryKey === "management");
    const staff = positions.filter((p) => p.categoryKey !== "management");
    return { mgmt, staff };
  }, [positions]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!jobPositionId) {
      setError("Выберите должность");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, jobPositionId, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Не удалось зарегистрироваться");
        return;
      }
      setDone(true);
    } catch {
      setError("Ошибка сети — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#116b2a]">
          <CheckCircle2 className="size-6" />
        </div>
        <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Готово
        </h2>
        <p className="mt-1.5 text-[14px] leading-[1.55] text-[#6f7282]">
          Аккаунт создан. Входите по номеру телефона{" "}
          <span className="font-mono text-[#0b1024]">{phone}</span> и паролю,
          который вы только что установили.
        </p>
        {/* Вход по телефону живёт на /mini/login — на /login сайта поле
            только для почты, а почта у сотрудника служебная и он её не
            знает. Номер подставляем строкой запроса. */}
        <a
          href={`/mini/login?phone=${encodeURIComponent(phone)}`}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
        >
          Войти в WeSetup
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
    >
      <Field label="ФИО">
        <input
          type="text"
          required
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Иванов Иван Иванович"
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </Field>

      <Field label="Телефон">
        <input
          type="tel"
          required
          {...phoneInputProps(phone, setPhone)}
          placeholder={RU_PHONE_PLACEHOLDER}
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
        <p className="mt-1.5 text-[12px] text-[#6f7282]">
          По нему будете входить и получать задачи.
        </p>
      </Field>

      <Field label="Должность">
        <select
          required
          value={jobPositionId}
          disabled={Boolean(lockedPositionId)}
          onChange={(e) => setJobPositionId(e.target.value)}
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:bg-[#f6f7fb] disabled:text-[#6f7282]"
        >
          <option value="">— выберите должность —</option>
          {grouped.mgmt.length > 0 && (
            <optgroup label="Руководство">
              {grouped.mgmt.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {grouped.staff.length > 0 && (
            <optgroup label="Сотрудники">
              {grouped.staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {lockedPositionId ? (
          <p className="mt-1.5 text-[12px] text-[#6f7282]">
            Должность указана в приглашении — менять её не нужно.
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] text-[#6f7282]">
            Выберите свою должность — от неё зависят журналы и задачи.
          </p>
        )}
      </Field>

      <Field label="Пароль">
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Минимум 8 символов"
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </Field>

      {error && (
        <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c8cbe0] disabled:shadow-none"
      >
        {busy ? "Сохраняем…" : "Зарегистрироваться"}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
        {label}
      </span>
      {children}
    </label>
  );
}
