"use client";

import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  Library,
  Loader2,
  Mail,
  PenLine,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { DishPoolSection } from "@/components/journals/dish-pool-section";
import { renameMasterCabinetDialog } from "@/components/master/rename-master-cabinet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { isBillingLimitError, useBillingError } from "@/lib/billing-limit-toast";
import type { MasterCabinetStatus } from "@/lib/master-cabinet";
import { cn } from "@/lib/utils";

type InviteResult = {
  created: boolean;
  email: string;
  inviteUrl: string;
  emailSent: boolean;
};

type PostResponse = {
  error?: string;
  created?: boolean;
  user?: { email: string };
  inviteUrl?: string;
  emailSent?: boolean;
  status?: MasterCabinetStatus;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6 md:p-7";
const EYEBROW = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const INPUT =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";

function copyText(value: string, okMessage: string, errorMessage: string) {
  void navigator.clipboard?.writeText(value).then(
    () => toast.success(okMessage),
    () => toast.error(errorMessage)
  );
}

/**
 * Настройка мастер-кабинета справочников у пищеблока:
 *   1) код справочника и объекты пула (+ подключение к чужому коду);
 *   2) создание кабинета и приглашение сотрудника бэк-офиса;
 *   3) сотрудники кабинета, повторная ссылка, переход в кабинет.
 */
export function MasterCabinetClient({
  initialStatus,
  organizationName,
  isDemo,
}: {
  initialStatus: MasterCabinetStatus;
  organizationName: string;
  isDemo: boolean;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const tRename = useTranslations("masterUi.renameMasterCabinet");
  const { toastApiError } = useBillingError();
  const [status, setStatus] = useState<MasterCabinetStatus>(initialStatus);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);

  const master = status.master;
  const objectsCount = status.poolOrganizations.length;
  const formValid = name.trim().length >= 2 && EMAIL_RE.test(email.trim());

  async function invite(person: { name: string; email: string }): Promise<boolean> {
    setError(null);
    const response = await fetch("/api/settings/master-cabinet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(person),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as PostResponse | null;
    if (!response?.ok || !json?.inviteUrl) {
      // Места тарифа заняты — тот же тост, что везде: следующий тариф и кнопка.
      // Окно подтверждения закрываем: иначе чат «Связаться» откроется под ним.
      if (isBillingLimitError(json)) {
        setConfirmOpen(false);
        toastApiError(json, t("apiFallbackError"));
        return false;
      }
      const message = json?.error ?? t("apiFallbackError");
      setError(message);
      toast.error(message);
      return false;
    }
    if (json.status) setStatus(json.status);
    setLastInvite({
      created: Boolean(json.created),
      email: json.user?.email ?? person.email,
      inviteUrl: json.inviteUrl,
      emailSent: json.emailSent !== false,
    });
    toast.success(json.created ? t("cabinetCreated") : t("inviteReady", { email: json.user?.email ?? person.email }));
    return true;
  }

  async function submitNew() {
    setBusy(true);
    try {
      const ok = await invite({ name: name.trim(), email: email.trim() });
      if (ok) {
        setName("");
        setEmail("");
        setConfirmOpen(false);
        setInviteFormOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend(user: { id: string; name: string; email: string }) {
    setResendingId(user.id);
    try {
      await invite({ name: user.name, email: user.email });
    } finally {
      setResendingId(null);
    }
  }

  /** Переименовать кабинет пула (название в шапке кабинета и в списке организаций). */
  async function rename() {
    if (!master) return;
    const result = await renameMasterCabinetDialog({ currentName: master.name, endpoint: "/api/settings/master-cabinet", t: tRename });
    if (!result) return;
    const next = result.body.status as MasterCabinetStatus | undefined;
    if (next) setStatus(next);
    else setStatus((prev) => (prev.master ? { ...prev, master: { ...prev.master, name: result.name } } : prev));
  }

  async function openCabinet() {
    if (!master) return;
    setOpening(true);
    try {
      const response = await fetch("/api/me/active-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: master.organizationId }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? t("openFailed"));
      window.location.assign("/master");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("openFailed"));
      setOpening(false);
    }
  }

  const inviteForm = (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!formValid || busy) return;
        if (master) void submitNew();
        else setConfirmOpen(true);
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("form.nameLabel")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("form.namePlaceholder")}
          autoComplete="name"
          disabled={busy || isDemo}
          className={INPUT}
          data-testid="master-invite-name"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Email</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="backoffice@company.ru"
          type="email"
          inputMode="email"
          autoComplete="email"
          disabled={busy || isDemo}
          className={INPUT}
          data-testid="master-invite-email"
        />
        <span className="mt-1.5 block text-[12px] leading-[1.5] text-[#6f7282]">
          {t("form.emailHint")}
        </span>
      </label>
      {error ? (
        <p className="rounded-2xl bg-[#fff4f2] px-4 py-2.5 text-[13px] text-[#a13a32]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={!formValid || busy || isDemo}
          className={cn(PRIMARY, "w-full sm:w-auto")}
          data-testid="master-invite-submit"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : master ? <UserPlus className="size-4" /> : <Library className="size-4" />}
          {master ? t("form.sendInvite") : t("form.createCabinet")}
        </button>
        {master ? (
          <button
            type="button"
            onClick={() => {
              setInviteFormOpen(false);
              setError(null);
            }}
            className={cn(OUTLINE, "h-12 w-full sm:w-auto")}
          >
            {t("form.cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );

  return (
    <div className="space-y-5">
      <PageGuide
        storageKey="settings-master-cabinet"
        title={t("guide.title")}
        bullets={[
          {
            title: t("guide.step1Title"),
            body: t("guide.step1Body"),
          },
          {
            title: t("guide.step2Title"),
            body: t("guide.step2Body"),
          },
          {
            title: t("guide.step3Title"),
            body: t("guide.step3Body"),
          },
        ]}
        qa={[
          {
            q: t("guide.qa1Q"),
            a: t("guide.qa1A"),
          },
          {
            q: t("guide.qa2Q"),
            a: t("guide.qa2A"),
          },
          {
            q: t("guide.qa3Q"),
            a: t("guide.qa3A"),
          },
          {
            q: t("guide.qa4Q"),
            a: t("guide.qa4A"),
          },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Код справочника и объекты пула */}
        <section className={CARD} aria-labelledby="master-code-title">
          <div id="master-code-title" className={EYEBROW}>
            {t("code.eyebrow")}
          </div>
          {status.code ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className="break-all font-mono text-[26px] font-semibold tracking-[0.08em] text-[#0b1024] sm:text-[30px]"
                data-testid="master-pool-code"
              >
                {status.code}
              </span>
              <button type="button" onClick={() => copyText(status.code ?? "", t("code.copied"), t("copyFailed"))} className={OUTLINE}>
                <Copy className="size-4 text-[#5566f6]" />
                {t("copy")}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[14px] leading-[1.55] text-[#3c4053]">
              {t("code.none")}
            </p>
          )}
          <p className="mt-2 text-[13px] leading-[1.55] text-[#6f7282]">
            {t("code.objectsReceive")}
          </p>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold text-[#0b1024]">{t("code.objectsWithCode")}</span>
              <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium tabular-nums text-[#3848c7]">
                {objectsCount}
              </span>
            </div>
            {objectsCount > 0 ? (
              <ul className="mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff]">
                {status.poolOrganizations.map((org) => (
                  <li key={org.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5 text-[14px] text-[#0b1024]">
                    <Building2 className="size-4 shrink-0 text-[#5566f6]" />
                    <span className="min-w-0 truncate">{org.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                {t("code.onlyThisOrg", { organizationName })}
              </p>
            )}
          </div>

          <div className="mt-5"><DishPoolSection hideTitle /></div>
        </section>

        {/* Мастер-кабинет */}
        <section className={CARD} aria-labelledby="master-cabinet-title">
          <div id="master-cabinet-title" className={EYEBROW}>
            {t("cabinet.eyebrow")}
          </div>

          {master ? (
            <div className="mt-3 space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <Library className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    <div className="min-w-0 break-words text-[16px] font-semibold leading-snug text-[#0b1024]" data-testid="master-cabinet-name">
                      {master.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => void rename()}
                      className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                      aria-label={t("cabinet.renameLabel")}
                      title={t("cabinet.rename")}
                      data-testid="master-cabinet-rename"
                    >
                      <PenLine className="size-4" />
                    </button>
                  </div>
                  <div className="mt-0.5 text-[13px] text-[#6f7282]">
                    {t("cabinet.distributes", { count: objectsCount })}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[14px] font-semibold text-[#0b1024]">{t("cabinet.employees")}</div>
                {master.users.length > 0 ? (
                  <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
                    {master.users.map((user) => (
                      <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
                          {(user.name || user.email).trim().slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-[#0b1024]">{user.name}</span>
                          <span className="block truncate text-[12.5px] text-[#6f7282]">{user.email}</span>
                        </span>
                        {user.invited ? (
                          <span className="flex items-center gap-2">
                            <span className="rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] font-medium text-[#9a4a06]">
                              {t("cabinet.invited")}
                            </span>
                            <button
                              type="button"
                              onClick={() => void resend(user)}
                              disabled={resendingId !== null}
                              className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:opacity-50"
                              title={t("cabinet.resendTitle")}
                            >
                              {resendingId === user.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3.5" />
                              )}
                              {t("cabinet.resend")}
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
                            <Check className="size-3.5" />
                            {t("cabinet.joined")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                    {t("cabinet.noEmployees")}
                  </p>
                )}
              </div>

              {inviteFormOpen ? (
                <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">{inviteForm}</div>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {master.viewerCanOpen ? (
                  <button
                    type="button"
                    onClick={() => void openCabinet()}
                    disabled={opening}
                    className={cn(PRIMARY, "w-full sm:w-auto")}
                    data-testid="master-open"
                  >
                    {opening ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                    {t("cabinet.open")}
                  </button>
                ) : null}
                {!inviteFormOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setInviteFormOpen(true);
                      setError(null);
                    }}
                    className={cn(OUTLINE, "h-12 w-full sm:w-auto")}
                  >
                    <UserPlus className="size-4 text-[#5566f6]" />
                    {t("cabinet.inviteMore")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <p className="text-[14px] leading-[1.6] text-[#3c4053]">
                {t("cabinet.noCabinet")}
              </p>
              {isDemo ? (
                <p className="rounded-2xl bg-[#fff8eb] px-4 py-3 text-[13px] text-[#9a4a06]">
                  {t("cabinet.demoNotice")}
                </p>
              ) : null}
              {inviteForm}
            </div>
          )}

          {lastInvite ? (
            <div
              className={cn(
                "mt-5 space-y-3 rounded-2xl border p-4",
                lastInvite.emailSent ? "border-[#c9f0da] bg-[#ecfdf5]" : "border-[#ffe2b8] bg-[#fff8eb]"
              )}
              data-testid="master-invite-result"
            >
              <div
                className={cn(
                  "flex items-start gap-2 text-[14px] font-medium",
                  lastInvite.emailSent ? "text-[#116b2a]" : "text-[#9a4a06]"
                )}
              >
                <Mail className="mt-0.5 size-4 shrink-0" />
                <span>
                  {lastInvite.emailSent
                    ? t("result.sent", { email: lastInvite.email })
                    : t("result.notSent", { email: lastInvite.email })}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  readOnly
                  value={lastInvite.inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label={t("result.linkLabel")}
                  className="h-10 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-3 font-mono text-[12.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  data-testid="master-invite-url"
                />
                <button
                  type="button"
                  onClick={() => copyText(lastInvite.inviteUrl, t("result.linkCopied"), t("copyFailed"))}
                  className={OUTLINE}
                >
                  <Copy className="size-4 text-[#5566f6]" />
                  {t("copy")}
                </button>
              </div>
              <p className="text-[12px] leading-[1.5] text-[#6f7282]">
                {t("result.validity")}
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={submitNew}
        title={t("confirm.title")}
        description={t("confirm.description", { name: name.trim() || "", email: email.trim() })}
        icon={Library}
        confirmLabel={t("confirm.confirmLabel")}
        bullets={[
          {
            label: t("confirm.bullet1"),
          },
          {
            label: t("confirm.bullet2"),
            tone: "info",
          },
          {
            label: t("confirm.bullet3", {
              code: status.code ? ` ${status.code}` : "",
              count: Math.max(objectsCount, 1),
            }),
            tone: "info",
          },
          { label: t("confirm.bullet4") },
        ]}
      />
    </div>
  );
}

