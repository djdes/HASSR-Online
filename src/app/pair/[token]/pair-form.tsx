"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Задание пароля при привязке.
 *
 * Два поля вместо одного: пароль набирается вслепую на чужом телефоне,
 * и опечатка означает «сотрудник заперт до следующей ссылки». Кнопка
 * показа пароля есть, но подтверждение всё равно оставляем — на кухне
 * экран нередко видит не только владелец.
 */
export function PairForm({ token }: { token: string }) {
  // До загрузки скриптов кнопка выключена: иначе браузер отправит форму сам (утечка пароля, 2026-11-24).
  const hydrated = useHydrated();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pair/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Не удалось сохранить пароль");
        return;
      }
      // Сессия уже выдана — сотрудник отдаёт телефон обратно уже
      // вошедшим, без повторного ввода. Переход именно перезагрузкой:
      // `/mini` смотрит на `useSession().status`, а тот не перечитает
      // куку при клиентской навигации.
      window.location.assign(body.redirect || "/mini");
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" onSubmit={submit} className="mt-5 space-y-3">
      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] text-[#6f7282]">
          Пароль
        </label>
        <div className="relative">
          <input
            id="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-14 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 pr-14 text-[17px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Скрыть пароль" : "Показать пароль"}
            className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl text-[#6f7282]"
          >
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        <p className="mt-1 text-[12px] text-[#9b9fb3]">Минимум 6 знаков</p>
      </div>

      <div>
        <label htmlFor="confirm" className="mb-1.5 block text-[13px] text-[#6f7282]">
          Повторите пароль
        </label>
        <input
          id="confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={`h-14 w-full rounded-2xl border bg-white px-4 text-[17px] text-[#0b1024] focus:outline-none focus:ring-4 ${
            mismatch
              ? "border-[#a13a32] focus:border-[#a13a32] focus:ring-[#a13a32]/15"
              : "border-[#dcdfed] focus:border-[#5566f6] focus:ring-[#5566f6]/15"
          }`}
        />
      </div>

      {error ? (
        <p role="alert" className="text-[14px] leading-[1.5] text-[#a13a32]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || password.length < 6 || password !== confirm || !hydrated}
        className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[16px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        Сохранить и войти
      </button>
    </form>
  );
}
