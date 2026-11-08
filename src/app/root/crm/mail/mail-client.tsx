"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Mail, Pencil, Plug, Plus, ShieldBan, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { crmFilterReasonLabel } from "@/lib/crm/constants";
import { IMAP_PRESETS, type MailboxView } from "@/lib/crm/mailbox";
import type { loadCrmMailPage } from "@/lib/crm/queries.server";
import { cn } from "@/lib/utils";
import { formatDateTime } from "../crm-format";
import { CARD, INPUT, SECONDARY_BUTTON } from "../crm-ui";

type Data = Awaited<ReturnType<typeof loadCrmMailPage>>;

type MailboxForm = {
  label: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  inboxFolder: string;
  sentFolder: string;
  enabled: boolean;
};

const EMPTY_FORM: MailboxForm = {
  label: "Рабочая почта",
  host: "imap.yandex.ru",
  port: "993",
  secure: true,
  username: "admin@wesetup.ru",
  password: "",
  inboxFolder: "INBOX",
  sentFolder: "Sent",
  enabled: true,
};

function formOf(mailbox: MailboxView): MailboxForm {
  return {
    label: mailbox.label,
    host: mailbox.host,
    port: String(mailbox.port),
    secure: mailbox.secure,
    username: mailbox.username,
    password: "",
    inboxFolder: mailbox.inboxFolder,
    sentFolder: mailbox.sentFolder ?? "",
    enabled: mailbox.enabled,
  };
}

async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Не получилось");
  return data;
}

export function MailClient({ data, canManageMailboxes }: { data: Data; canManageMailboxes: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; form: MailboxForm } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rule, setRule] = useState({ pattern: "", action: "block" as "block" | "allow" });

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не получилось");
    } finally {
      setBusy(null);
    }
  }

  async function saveMailbox() {
    if (!editing) return;
    const form = editing.form;
    const body = { ...form, port: Number(form.port), sentFolder: form.sentFolder.trim() || undefined, password: form.password || undefined };
    await run("mailbox", async () => {
      await call(editing.id ? `/api/root/crm/mailboxes/${editing.id}` : "/api/root/crm/mailboxes", editing.id ? "PUT" : "POST", body);
      toast.success(editing.id ? "Ящик сохранён" : "Ящик подключён", { description: "Нажмите «Проверить», затем «Обновить сейчас» — письма за 30 дней попадут в CRM." });
      setEditing(null);
    });
  }

  async function testMailbox(id: string) {
    await run(`test:${id}`, async () => {
      const result = (await call(`/api/root/crm/mailboxes/${id}/test`, "POST")) as { ok: boolean; error?: string; folders?: string[]; suggestedSent?: string | null };
      if (!result.ok) throw new Error(result.error ?? "Не удалось подключиться");
      toast.success("Подключение работает", {
        description: `Папки: ${(result.folders ?? []).slice(0, 8).join(", ")}${result.suggestedSent ? `. Отправленные: «${result.suggestedSent}»` : ""}`,
      });
    });
  }

  const set = (key: keyof MailboxForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setEditing((current) => (current ? { ...current, form: { ...current.form, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value } } : current));

  return (
    <div className="space-y-6">
      <section className={CARD} data-crm-mailboxes>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f6] px-4 py-3 sm:px-5">
          <span className="text-[15px] font-semibold text-[#0b1024]">Ящики</span>
          {canManageMailboxes ? (
            <button type="button" onClick={() => setEditing({ id: null, form: EMPTY_FORM })} className={cn(SECONDARY_BUTTON, "h-9 text-[13px]")} data-crm-mailbox-add>
              <Plus className="size-4" /> Подключить ящик
            </button>
          ) : null}
        </div>
        {data.mailboxes.length ? (
          <ul className="divide-y divide-[#eef0f6]">
            {data.mailboxes.map((mailbox) => (
              <li key={mailbox.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5" data-crm-mailbox={mailbox.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-[#0b1024]">
                    <Mail className="size-4 text-[#5566f6]" />
                    {mailbox.label}
                    {!mailbox.enabled ? <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] text-[#6f7282]">выключен</span> : null}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282]">
                    {mailbox.username} · {mailbox.host}:{mailbox.port} · {mailbox.inboxFolder}
                    {mailbox.sentFolder ? ` + ${mailbox.sentFolder}` : ""}
                  </div>
                  <div className={cn("mt-0.5 text-[12.5px]", mailbox.lastError ? "text-[#a13a32]" : "text-[#9b9fb3]")}>
                    {mailbox.lastError ? mailbox.lastError : mailbox.lastSyncAt ? `Прочитан ${formatDateTime(mailbox.lastSyncAt)}` : "Ещё не читался"}
                  </div>
                </div>
                {canManageMailboxes ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => testMailbox(mailbox.id)} disabled={busy !== null} className={cn(SECONDARY_BUTTON, "h-9 text-[13px]")}>
                      {busy === `test:${mailbox.id}` ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Проверить
                    </button>
                    <button type="button" onClick={() => setEditing({ id: mailbox.id, form: formOf(mailbox) })} className={cn(SECONDARY_BUTTON, "h-9 text-[13px]")}>
                      <Pencil className="size-4" /> Изменить
                    </button>
                    <button
                      type="button"
                      onClick={() => run(`delete:${mailbox.id}`, async () => void (await call(`/api/root/crm/mailboxes/${mailbox.id}`, "DELETE")))}
                      disabled={busy !== null}
                      className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px] text-[#a13a32]")}
                      aria-label="Удалить ящик"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-5 text-[13.5px] leading-relaxed text-[#6f7282]">
            Ни одного ящика. {canManageMailboxes ? "Подключите рабочую почту admin@wesetup.ru: для Яндекс 360 нужен пароль приложения (Яндекс ID → Безопасность → Пароли приложений → Почта) и включённый IMAP." : "Ящики подключает владелец платформы."}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className={CARD} data-crm-filtered>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#eef0f6] px-4 py-3 sm:px-5">
            <span className="text-[15px] font-semibold text-[#0b1024]">Отсеяно</span>
            <span className="flex flex-wrap gap-1.5">
              {data.reasons.map((item) => (
                <span key={item.reason} className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3c4053]">
                  {crmFilterReasonLabel(item.reason)}: {item.count}
                </span>
              ))}
            </span>
          </div>
          {data.filtered.length ? (
            <ul className="divide-y divide-[#eef0f6]">
              {data.filtered.map((item) => (
                <li key={item.id} className="space-y-1.5 px-4 py-3 sm:px-5" data-crm-filtered-item={item.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="truncate text-[14px] font-medium text-[#0b1024]">{item.fromName ? `${item.fromName} <${item.fromAddress ?? ""}>` : (item.fromAddress ?? "без адреса")}</span>
                    <span className="text-[12px] text-[#9b9fb3]">{formatDateTime(item.occurredAt)}</span>
                  </div>
                  <div className="text-[13px] text-[#3c4053]">
                    <span className="mr-2 rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11.5px] text-[#7a4a00]">{crmFilterReasonLabel(item.filteredReason ?? "")}</span>
                    {item.subject || "(без темы)"}
                  </div>
                  <p className="line-clamp-2 text-[12.5px] text-[#6f7282]">{item.body}</p>
                  {item.fromAddress ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`restore:${item.id}`, async () => {
                            const result = (await call(`/api/root/crm/filtered/${item.id}`, "POST", { allowSender: false })) as { contactId?: string };
                            toast.success("Письмо возвращено в переписку", { action: result.contactId ? { label: "Открыть", onClick: () => router.push(`/root/crm/contacts/${result.contactId}`) } : undefined });
                          })
                        }
                        className={cn(SECONDARY_BUTTON, "h-8 px-3 text-[12.5px]")}
                      >
                        <Undo2 className="size-3.5" /> Вернуть
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`allow:${item.id}`, async () => {
                            await call(`/api/root/crm/filtered/${item.id}`, "POST", { allowSender: true });
                            toast.success("Вернули и запомнили: письма этого адреса больше не отсеиваются");
                          })
                        }
                        className={cn(SECONDARY_BUTTON, "h-8 px-3 text-[12.5px]")}
                      >
                        <ShieldCheck className="size-3.5" /> Вернуть и всегда пропускать
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-5 text-[13.5px] text-[#6f7282]">Ничего не отсеяно.</p>
          )}
          {data.pages > 1 ? (
            <div className="flex justify-between border-t border-[#eef0f6] px-4 py-3 text-[13px] sm:px-5">
              {data.page > 1 ? <Link href={`/root/crm/mail?page=${data.page - 1}`} className="text-[#3848c7] hover:underline">← Новее</Link> : <span />}
              <span className="text-[#6f7282]">{data.page} из {data.pages}</span>
              {data.page < data.pages ? <Link href={`/root/crm/mail?page=${data.page + 1}`} className="text-[#3848c7] hover:underline">Старше →</Link> : <span />}
            </div>
          ) : null}
        </section>

        <section className={cn(CARD, "h-fit")} data-crm-rules>
          <div className="border-b border-[#eef0f6] px-4 py-3 text-[15px] font-semibold text-[#0b1024] sm:px-5">Правила отправителей</div>
          <form
            className="space-y-2 px-4 py-3 sm:px-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run("rule", async () => {
                await call("/api/root/crm/rules", "POST", rule);
                toast.success(rule.action === "block" ? "Адрес в стоп-листе" : "Адрес всегда пропускается");
                setRule({ pattern: "", action: rule.action });
              });
            }}
          >
            <input value={rule.pattern} onChange={(event) => setRule({ ...rule, pattern: event.target.value })} className={INPUT} placeholder="ivan@site.ru или site.ru" aria-label="Адрес или домен" data-crm-rule-pattern />
            <div className="flex flex-wrap gap-2">
              <select value={rule.action} onChange={(event) => setRule({ ...rule, action: event.target.value as "block" | "allow" })} className={cn(INPUT, "h-10 w-auto flex-1")} aria-label="Что делать">
                <option value="block">Всегда отсеивать</option>
                <option value="allow">Всегда принимать</option>
              </select>
              <button type="submit" disabled={busy !== null || rule.pattern.trim().length < 3} className={cn(SECONDARY_BUTTON, "h-10")}>
                Добавить
              </button>
            </div>
          </form>
          {data.rules.length ? (
            <ul className="divide-y divide-[#eef0f6] border-t border-[#eef0f6]">
              {data.rules.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13.5px] text-[#0b1024]">
                      {item.action === "block" ? <ShieldBan className="size-4 text-[#a13a32]" /> : <CheckCircle2 className="size-4 text-[#116b2a]" />}
                      <span className="truncate">{item.pattern}</span>
                    </span>
                    {item.note ? <span className="block truncate text-[12px] text-[#9b9fb3]">{item.note}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => run(`rule:${item.id}`, async () => void (await call(`/api/root/crm/rules/${item.id}`, "DELETE")))}
                    disabled={busy !== null}
                    className="rounded-xl p-1.5 text-[#9b9fb3] hover:bg-[#fff4f2] hover:text-[#a13a32]"
                    aria-label={`Удалить правило ${item.pattern}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-[#eef0f6] px-5 py-4 text-[12.5px] text-[#6f7282]">Правил нет. Отсев работает по заголовкам письма: автоответы, рассылки, недоставки, роботы, спам.</p>
          )}
        </section>
      </div>

      {editing ? (
        <ConfirmDialog
          open
          onClose={() => setEditing(null)}
          onConfirm={saveMailbox}
          title={editing.id ? "Ящик IMAP" : "Подключить ящик"}
          description="Пароль хранится зашифрованным и обратно не показывается. Для Яндекса и Mail.ru — пароль приложения, не обычный."
          icon={Mail}
          confirmLabel="Сохранить"
          cancelLabel="Отмена"
          confirmDisabled={!editing.form.host || !editing.form.username || (!editing.id && !editing.form.password)}
        >
          <div className="space-y-3" data-crm-mailbox-form>
            <div className="flex flex-wrap gap-1.5">
              {IMAP_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setEditing((current) => (current ? { ...current, form: { ...current.form, host: preset.host, port: String(preset.port), secure: preset.secure, sentFolder: preset.sentFolder } } : current))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[12px]",
                    editing.form.host === preset.host ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#ececf4] text-[#3c4053] hover:border-[#5566f6]/40",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[13px] text-[#3c4053]">
                Название
                <input value={editing.form.label} onChange={set("label")} className={cn(INPUT, "mt-1")} />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                Логин (адрес)
                <input value={editing.form.username} onChange={set("username")} className={cn(INPUT, "mt-1")} autoComplete="off" />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                IMAP-сервер
                <input value={editing.form.host} onChange={set("host")} className={cn(INPUT, "mt-1")} />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                Порт
                <input value={editing.form.port} onChange={set("port")} className={cn(INPUT, "mt-1")} inputMode="numeric" />
              </label>
              <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
                Пароль{editing.id ? " (пусто — оставить прежний)" : ""}
                <input type="password" value={editing.form.password} onChange={set("password")} className={cn(INPUT, "mt-1")} autoComplete="new-password" />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                Папка входящих
                <input value={editing.form.inboxFolder} onChange={set("inboxFolder")} className={cn(INPUT, "mt-1")} />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                Папка отправленных
                <input value={editing.form.sentFolder} onChange={set("sentFolder")} className={cn(INPUT, "mt-1")} placeholder="Sent — наши ответы снимают «ждёт ответа»" />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-[13px] text-[#3c4053]">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={editing.form.secure} onChange={set("secure")} className="size-4 accent-[#5566f6]" /> SSL/TLS
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={editing.form.enabled} onChange={set("enabled")} className="size-4 accent-[#5566f6]" /> Читать ящик
              </label>
            </div>
            <p className="text-[12px] leading-snug text-[#6f7282]">Первый проход берёт письма за 30 дней, дальше — только новые. Ящик открывается только на чтение: письма не помечаются прочитанными и не удаляются.</p>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
