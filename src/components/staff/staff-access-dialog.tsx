"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { brandQrHeightFor } from "@/lib/brand-qr-shared";
import { Copy, Dices, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { generateStaffPassword } from "@/lib/login-prefix";
import {
  JournalMultiSelect,
  type JournalOption,
} from "@/components/staff/journal-multi-select";
import { cn } from "@/lib/utils";

/**
 * Окно выдачи доступа сотруднику.
 *
 * Раньше доступ собирался из трёх разных мест: пароль не выдавался
 * вообще (сотрудник заводился с пустым хэшем и войти не мог),
 * Telegram-приглашение жило в мастере добавления, а журналы — в
 * отдельной странице настроек. Здесь всё три в одном месте, потому что
 * решение «этот человек будет вести вот эти журналы вот отсюда»
 * принимается один раз и целиком.
 */

type AccessPayload = {
  loginPrefix: string;
  positionPresetCodes: string[];
  user: {
    id: string;
    name: string | null;
    positionTitle: string | null;
    contactEmail: string | null;
    hasBrowserAccess: boolean;
    hasTelegramAccess: boolean;
    login: string | null;
    journalAccessMigrated: boolean;
  };
  catalog: JournalOption[];
  access: Array<{ templateCode: string; canRead: boolean }>;
};

const FIELD_CLASS =
  "h-11 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export function StaffAccessDialog({
  open,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<AccessPayload | null>(null);
  const [busy, setBusy] = useState(false);

  const [browserOn, setBrowserOn] = useState(false);
  const [loginSuffix, setLoginSuffix] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [contactEmail, setContactEmail] = useState("");

  const [telegramOn, setTelegramOn] = useState(false);
  const [invite, setInvite] = useState<{
    inviteUrl: string;
    qrPngDataUrl: string;
  } | null>(null);

  const [codes, setCodes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/users/${userId}/access`).catch(() => null);
    if (!response?.ok) {
      toast.error("Не удалось загрузить доступы");
      return;
    }
    const payload: AccessPayload = await response.json();
    setData(payload);
    setContactEmail(payload.user.contactEmail ?? "");
    setBrowserOn(payload.user.hasBrowserAccess);
    setTelegramOn(payload.user.hasTelegramAccess);

    const granted = payload.access
      .filter((row) => row.canRead)
      .map((row) => row.templateCode);
    // Сотрудник из legacy-режима видит ВСЕ журналы, хотя строк ACL у него
    // нет. Показать пустой список значило бы соврать: нажав «Сохранить»,
    // человек молча отобрал бы у него всё.
    const legacyFullAccess =
      !payload.user.journalAccessMigrated && granted.length === 0;
    setCodes(
      legacyFullAccess ? payload.catalog.map((item) => item.code) : granted
    );
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    setData(null);
    void load();
  }, [open, load]);

  async function issueInvite() {
    setBusy(true);
    try {
      const response = await fetch(`/api/staff/${userId}/invite-tg`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.inviteUrl) {
        throw new Error(payload?.error ?? "Не удалось выдать приглашение");
      }
      setInvite({
        inviteUrl: payload.inviteUrl,
        qrPngDataUrl: payload.qrPngDataUrl,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      const wantsCredentials =
        browserOn && (loginSuffix.trim().length > 0 || password.length > 0);
      const contactChanged =
        contactEmail.trim() !== (data.user.contactEmail ?? "");

      if (wantsCredentials || contactChanged) {
        const response = await fetch(`/api/staff/${userId}/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            loginSuffix: loginSuffix.trim() || undefined,
            password: password || undefined,
            contactEmail: contactChanged ? contactEmail.trim() : undefined,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось выдать доступ");
        }
      }

      const accessResponse = await fetch(`/api/users/${userId}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access: codes.map((templateCode) => ({
            templateCode,
            canRead: true,
            canWrite: true,
            canFinalize: false,
          })),
        }),
      });
      if (!accessResponse.ok) {
        const payload = await accessResponse.json().catch(() => null);
        throw new Error(payload?.error ?? "Не удалось сохранить доступ к журналам");
      }

      toast.success("Доступ сохранён");
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="flex max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-[#ececf4] px-6 py-4">
          <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">
            Добавление доступа
          </DialogTitle>
          {data ? (
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              {data.user.name}
              {data.user.positionTitle ? ` · ${data.user.positionTitle}` : ""}
            </p>
          ) : null}
        </DialogHeader>

        {!data ? (
          <div className="flex items-center gap-2 px-6 py-10 text-[13.5px] text-[#9b9fb3]">
            <Loader2 className="size-4 animate-spin" />
            Загружаем доступы
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <label className="block space-y-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                Email сотрудника · необязательно
              </span>
              <input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="Личная почта для связи"
                className={FIELD_CLASS}
              />
            </label>

            <div className="space-y-3">
              <label className="flex items-center gap-3 rounded-2xl bg-[#f5f6ff] px-4 py-3">
                <Switch checked={browserOn} onCheckedChange={setBrowserOn} />
                <span className="text-[14px] font-medium text-[#0b1024]">
                  Доступ в сервис через браузер
                </span>
              </label>

              {browserOn ? (
                <div className="space-y-2.5 pl-1">
                  {data.user.hasBrowserAccess && data.user.login ? (
                    <p className="text-[12.5px] text-[#6f7282]">
                      Доступ уже выдан, логин{" "}
                      <span className="font-medium text-[#0b1024]">
                        {data.user.login}
                      </span>
                      . Заполните поля ниже, чтобы сменить.
                    </p>
                  ) : (
                    <p className="text-[12.5px] text-[#6f7282]">
                      Придумайте логин и пароль — сотрудник войдёт с ними на
                      сайте.
                    </p>
                  )}

                  <div className="flex overflow-hidden rounded-xl border border-[#dcdfed] bg-white focus-within:border-[#5566f6] focus-within:ring-4 focus-within:ring-[#5566f6]/15">
                    {/* Префикс не редактируется: он от организации и
                        разводит одинаковые логины между заведениями. */}
                    <span className="flex shrink-0 items-center bg-[#f5f6ff] px-3 text-[14px] font-medium text-[#6f7282]">
                      {data.loginPrefix}
                    </span>
                    <input
                      value={loginSuffix}
                      onChange={(event) => setLoginSuffix(event.target.value)}
                      placeholder="логин"
                      autoComplete="off"
                      className="h-11 min-w-0 flex-1 px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Пароль"
                        autoComplete="new-password"
                        className={cn(FIELD_CLASS, "pr-10")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#9b9fb3] transition-colors hover:text-[#0b1024]"
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPassword(generateStaffPassword());
                        // Сгенерированный пароль показываем сразу: его надо
                        // переписать или продиктовать, а не угадывать.
                        setShowPassword(true);
                      }}
                      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff]"
                    >
                      <Dices className="size-4 text-[#5566f6]" />
                      Сгенерировать
                    </button>
                  </div>

                  {password ? (
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(`${data.loginPrefix}${loginSuffix} / ${password}`)
                          .then(() => toast.success("Логин и пароль скопированы"))
                          .catch(() => toast.error("Не удалось скопировать"));
                      }}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
                    >
                      <Copy className="size-3.5" />
                      Скопировать логин и пароль
                    </button>
                  ) : null}
                </div>
              ) : null}

              <label className="flex items-center gap-3 rounded-2xl bg-[#f5f6ff] px-4 py-3">
                <Switch
                  checked={telegramOn}
                  onCheckedChange={(next) => {
                    setTelegramOn(next);
                    if (next && !invite && !data.user.hasTelegramAccess) {
                      void issueInvite();
                    }
                  }}
                />
                <span className="text-[14px] font-medium text-[#0b1024]">
                  Доступ в сервис через бота в Telegram
                </span>
              </label>

              {telegramOn ? (
                <div className="space-y-2 pl-1">
                  {data.user.hasTelegramAccess && !invite ? (
                    <p className="text-[12.5px] text-[#6f7282]">
                      Telegram уже привязан.
                    </p>
                  ) : invite ? (
                    <div className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-3">
                      <Image
                        src={invite.qrPngDataUrl}
                        alt="QR-код приглашения"
                        width={128}
                        height={brandQrHeightFor(128)}
                        unoptimized
                        // 128 px: фирменный QR (коррекция H) плотнее — на 96 px с экрана читался хуже.
                        className="h-auto w-32 shrink-0 rounded-lg"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-[12.5px] leading-snug text-[#6f7282]">
                          Сотрудник открывает ссылку с телефона — кабинет
                          активируется при первом входе в Telegram.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(invite.inviteUrl)
                              .then(() => toast.success("Ссылка скопирована"))
                              .catch(() => toast.error("Не удалось скопировать"));
                          }}
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
                        >
                          <Copy className="size-3.5" />
                          Скопировать ссылку
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[13px] text-[#9b9fb3]">
                      <Loader2 className="size-4 animate-spin" />
                      Готовим приглашение
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                Доступ к журналам
              </div>
              <JournalMultiSelect
                options={data.catalog}
                value={codes}
                onChange={setCodes}
                positionPresetCodes={data.positionPresetCodes}
                positionTitle={data.user.positionTitle}
              />
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#ececf4] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors hover:bg-[#fafbff]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !data}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Сохранить
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
