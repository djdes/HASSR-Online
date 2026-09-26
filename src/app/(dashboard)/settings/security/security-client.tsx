"use client";

import { LogOut, MessageCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LOGOUT_ALL_URL, signOutAndOpen } from "@/lib/sign-out";

type LoginRow = {
  id: string;
  at: string;
  ip: string;
  device: string;
  method: string;
  isNewDevice: boolean;
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";

export function SecurityClient({
  logins,
  twoFactor,
}: {
  logins: LoginRow[];
  twoFactor: { enabled: boolean; telegramLinked: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeEnabled, setCodeEnabled] = useState(twoFactor.enabled);
  const [codeBusy, setCodeBusy] = useState(false);

  async function toggleCode(next: boolean) {
    setCodeBusy(true);
    try {
      const response = await fetch("/api/security/two-factor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Не удалось");
      setCodeEnabled(next);
      toast.success(next ? "Теперь при входе попросим код из Telegram" : "Код при входе выключен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setCodeBusy(false);
    }
  }

  async function logoutAll() {
    setBusy(true);
    try {
      // Тот же полный выход, что у «Выйти» (`lib/sign-out.ts`), только
      // сервер ещё и отзывает сессии на всех устройствах. Дальше — полная
      // перезагрузка на /login: клиентское состояние про сессию уже врёт.
      await signOutAndOpen("/login", { logoutUrl: LOGOUT_ALL_URL });
    } catch {
      toast.error("Не удалось завершить сессии. Проверьте связь и попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className={CARD}>
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">История входов</div>
        {logins.length === 0 ? (
          <p className="text-[13.5px] text-[#9b9fb3]">Пока пусто: история ведётся с сентября 2026 года и пополняется с каждым входом.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 font-medium">Когда</th>
                  <th className="pb-2 font-medium">Устройство</th>
                  <th className="pb-2 font-medium">Способ</th>
                  <th className="pb-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((row) => (
                  <tr key={row.id} className="border-t border-[#f2f3f8]">
                    <td className="py-2.5 text-[#0b1024]">{new Date(row.at).toLocaleString("ru-RU")}</td>
                    <td className="py-2.5 text-[#0b1024]">
                      {row.device}
                      {row.isNewDevice ? (
                        <span className="ml-2 rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] font-medium text-[#b25f00]">
                          новое устройство
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-[#6f7282]">{row.method}</td>
                    <td className="py-2.5 tabular-nums text-[#6f7282]">{row.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[12.5px] leading-relaxed text-[#9b9fb3]">
          О входе с нового устройства мы пишем на почту и в Telegram. Не узнаёте вход — завершите все
          сессии и смените пароль.
        </p>
      </section>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <ShieldCheck className="size-4 text-[#5566f6]" />
            Выйти везде
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            Завершит сессии на всех устройствах: телефон, планшет на кухне, чужой компьютер, где вы
            забыли выйти. Здесь тоже придётся войти заново.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#ef4444] to-[#f43f5e] px-5 text-[14px] font-medium text-white shadow-[0_12px_30px_-12px_rgba(244,63,94,0.6)] transition-opacity hover:opacity-90"
          >
            <LogOut className="size-4" />
            Завершить все сессии
          </button>
        </section>
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <MessageCircle className="size-4 text-[#5566f6]" />
            Код в Telegram при входе
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            После пароля попросим шестизначный код из Telegram. Даже с украденным паролем в
            кабинет не войти. Вход через сам Telegram кода не требует.
          </p>
          {twoFactor.telegramLinked ? (
            <button
              type="button"
              onClick={() => void toggleCode(!codeEnabled)}
              disabled={codeBusy}
              className={
                codeEnabled
                  ? "mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
                  : "mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
              }
            >
              {codeEnabled ? "Выключить код" : "Включить код"}
            </button>
          ) : (
            <p className="mt-3 rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#b25f00]">
              Сначала привяжите Telegram — код приходит туда. Это делается в профиле приложения.
            </p>
          )}
          {codeEnabled ? (
            <p className="mt-3 text-[12px] text-[#116b2a]">Включено: при входе по паролю попросим код.</p>
          ) : null}
        </section>
      </aside>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={logoutAll}
        variant="danger"
        title="Завершить все сессии?"
        description="Выйдете на всех устройствах, включая это. Пароль не меняется — если его знает кто-то ещё, смените и его."
        bullets={[
          { label: "Телефон, планшет, все браузеры — выйдут сразу", tone: "warn" },
          { label: "Здесь откроется страница входа" },
        ]}
        confirmLabel={busy ? "Завершаем…" : "Завершить все сессии"}
        confirmDisabled={busy}
      />
    </div>
  );
}
