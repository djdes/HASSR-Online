"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MessageCircle,
  PencilLine,
  Phone,
  Search,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import {
  Card,
  Pill,
  btnDanger,
  btnOutline,
  btnPrimary,
  inputClass,
  readError,
} from "@/components/partner/ui";
import { type PartnerAccessLevel } from "@/lib/partners/access-guard";
import { phoneHref, telegramHref } from "@/lib/partners/consultant-contact-shared";
import { parseAttachInput } from "@/lib/partners/validation";
import { cn } from "@/lib/utils";

type Consultant = {
  partnerClientId: string;
  accessLevel: PartnerAccessLevel;
  clientHidesBranding: boolean;
  attachedAt: string;
  partnerStatus: string;
  partnerType: string;
  city: string | null;
  brandName: string;
  slug: string;
  logoUrl: string | null;
  supportPhone: string | null;
  supportTelegram: string | null;
  supportEmail: string | null;
  consultantLine: string | null;
  /** Партнёр скрыт от клиента — показываем нейтральную «Службу сопровождения». */
  hidden?: boolean;
};

type Preview = { slug: string; brandName: string; active: boolean; ownOrganization: boolean };

const LEVEL_OPTIONS: { value: PartnerAccessLevel; icon: typeof Eye }[] = [
  { value: "view", icon: Eye },
  { value: "edit", icon: PencilLine },
];

type ConsultantT = ReturnType<typeof useTranslations<"settingsUi.consultantClient">>;

function levelLabel(t: ConsultantT, level: PartnerAccessLevel): string {
  return level === "edit" ? t("levelEdit") : t("levelView");
}

function levelHint(t: ConsultantT, level: PartnerAccessLevel): string {
  return level === "edit" ? t("levelEditHint") : t("levelViewHint");
}

/**
 * Настройки → «Консультант»: подключить по ссылке/коду, сменить уровень
 * доступа, скрыть брендинг, отключить. Одна карточка — одно действие,
 * каждое с подсказкой «что произойдёт».
 */
export function ConsultantSettingsClient({
  initialAttachSlug,
  initialAttachLevel,
}: {
  initialAttachSlug: string | null;
  initialAttachLevel: PartnerAccessLevel;
}) {
  const t = useTranslations("settingsUi.consultantClient");
  const locale = useLocale();
  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  const [consultant, setConsultant] = useState<Consultant | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [detachOpen, setDetachOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/consultant", { cache: "no-store" });
    if (!res.ok) {
      toast.error(await readError(res, t("loadFailed")));
      setConsultant(null);
      return;
    }
    const data = (await res.json()) as { consultant: Consultant | null };
    setConsultant(data.consultant);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, key: string, okText: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/settings/consultant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res, t("saveFailed")));
      const data = (await res.json()) as { consultant: Consultant | null };
      setConsultant(data.consultant);
      toast.success(okText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function detach() {
    const res = await fetch("/api/settings/consultant", { method: "DELETE" });
    if (!res.ok) {
      toast.error(await readError(res, t("detachFailed")));
      return;
    }
    setDetachOpen(false);
    setConsultant(null);
    toast.success(t("detached"));
  }

  if (consultant === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-3xl border border-[#ececf4] bg-white px-6 py-10 text-[14px] text-[#6f7282]">
        <Loader2 className="size-4 animate-spin text-[#5566f6]" />
        {t("loading")}
      </div>
    );
  }

  if (!consultant) {
    return (
      <>
        <PageGuide
          storageKey="settings-consultant"
          title={t("guideTitle")}
          bullets={[
            { title: t("guide1Title"), body: t("guide1Body") },
            { title: t("guide2Title"), body: t("guide2Body") },
            { title: t("guide3Title"), body: t("guide3Body") },
          ]}
        />
        <AttachCard initialSlug={initialAttachSlug} initialLevel={initialAttachLevel} onAttached={load} />
      </>
    );
  }

  const contacts = [
    consultant.supportPhone ? { icon: Phone, label: consultant.supportPhone, href: phoneHref(consultant.supportPhone) } : null,
    consultant.supportTelegram
      ? { icon: MessageCircle, label: consultant.supportTelegram, href: telegramHref(consultant.supportTelegram) }
      : null,
    consultant.supportEmail ? { icon: Mail, label: consultant.supportEmail, href: `mailto:${consultant.supportEmail}` } : null,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  const partnerActive = consultant.partnerStatus === "active";

  return (
    <div className="space-y-5">
      <Card eyebrow={t("yourConsultant")}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff] p-2">
            {consultant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={consultant.logoUrl} alt={consultant.brandName} className="max-h-full max-w-full object-contain" />
            ) : (
              <Building2 className="size-6 text-[#3848c7]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{consultant.brandName}</div>
              <Pill tone={partnerActive ? "ok" : "warn"}>{partnerActive ? t("accompanies") : t("partnerSuspended")}</Pill>
              <Pill tone="indigo">{levelLabel(t, consultant.accessLevel)}</Pill>
            </div>
            <div className="mt-1 text-[13px] text-[#6f7282]">
              {consultant.city ? `${consultant.city} · ` : ""}{t("attachedOn", { date: formatDate(consultant.attachedAt) })}
            </div>
            {contacts.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
                {contacts.map((c) => (
                  <a key={c.label} href={c.href} className="inline-flex items-center gap-1.5 text-[#0b1024] transition-colors hover:text-[#3848c7]">
                    <c.icon className="size-4 text-[#5566f6]" />
                    {c.label}
                  </a>
                ))}
              </div>
            ) : consultant.hidden ? (
              <div className="mt-3 text-[13px] text-[#6f7282]">{t("contactViaChat")}</div>
            ) : (
              <div className="mt-3 text-[13px] text-[#9b9fb3]">{t("noContacts")}</div>
            )}
            {!partnerActive ? (
              <p className="mt-3 rounded-2xl bg-[#fff4f2] px-3 py-2 text-[13px] leading-[1.5] text-[#a13a32]">
                {t("suspendedNote")}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card
        eyebrow={t("accessEyebrow")}
        title={t("accessTitle")}
      >
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("accessLabel")}>
          {LEVEL_OPTIONS.map((opt) => {
            const active = consultant.accessLevel === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy !== null}
                onClick={() =>
                  !active &&
                  void patch(
                    { accessLevel: opt.value },
                    "level",
                    opt.value === "edit"
                      ? t("nowCanEdit", { name: consultant.brandName })
                      : t("nowViewOnly", { name: consultant.brandName }),
                  )
                }
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-150 disabled:cursor-wait",
                  active
                    ? "border-[#5566f6] bg-[#f5f6ff] ring-4 ring-[#5566f6]/10"
                    : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl",
                    active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]",
                  )}
                >
                  <opt.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-[#0b1024]">{levelLabel(t, opt.value)}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#6f7282]">{levelHint(t, opt.value)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-[1.5] text-[#6f7282]">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#116b2a]" />
          {t.rich("levelNote", {
            mark: consultant.hidden ? t("markSupport") : t("markPartner"),
            link: (chunks) => (
              <Link href="/settings/audit" className="text-[#3848c7] underline-offset-2 hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Card>

      {consultant.hidden ? null : (
      <Card eyebrow={t("brandingEyebrow")} title={t("brandingTitle")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[560px] text-[14px] leading-[1.55] text-[#3c4053]">
            {t("brandingBody", { name: consultant.brandName })}
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void patch(
                { hideBranding: !consultant.clientHidesBranding },
                "branding",
                consultant.clientHidesBranding ? t("brandingShown") : t("brandingHidden"),
              )
            }
            className={cn(btnOutline, "shrink-0")}
          >
            {consultant.clientHidesBranding ? <Eye className="size-4 text-[#5566f6]" /> : <EyeOff className="size-4 text-[#5566f6]" />}
            {consultant.clientHidesBranding ? t("showBranding") : t("hideBranding")}
          </button>
        </div>
      </Card>
      )}

      <Card eyebrow={t("detachEyebrow")} title={t("detachTitle")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[560px] text-[14px] leading-[1.55] text-[#3c4053]">
            {t("detachBody")}
          </p>
          <button type="button" onClick={() => setDetachOpen(true)} className={cn(btnDanger, "shrink-0")}>
            <Unplug className="size-4" />
            {t("detachButton")}
          </button>
        </div>
      </Card>

      <ConfirmDialog
        open={detachOpen}
        onClose={() => setDetachOpen(false)}
        onConfirm={detach}
        variant="danger"
        title={t("detachDialogTitle", { name: consultant.brandName })}
        description={t("detachDialogDescription")}
        bullets={[
          { label: t("detachBullet1"), tone: "warn" },
          { label: t("detachBullet2") },
          { label: t("detachBullet3") },
          { label: t("detachBullet4") },
        ]}
        confirmLabel={t("detach")}
      />
    </div>
  );
}

function AttachCard({
  initialSlug,
  initialLevel,
  onAttached,
}: {
  initialSlug: string | null;
  initialLevel: PartnerAccessLevel;
  onAttached: () => Promise<void>;
}) {
  const t = useTranslations("settingsUi.consultantClient");
  const [raw, setRaw] = useState(initialSlug ?? "");
  const [level, setLevel] = useState<PartnerAccessLevel>(initialLevel);
  const [preview, setPreview] = useState<Preview | null | "missing">(null);
  const [looking, setLooking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const parsed = useMemo(() => parseAttachInput(raw), [raw]);

  const lookup = useCallback(async () => {
    if (!parsed) {
      setPreview(null);
      return;
    }
    setLooking(true);
    try {
      const qs = "slug" in parsed ? `slug=${encodeURIComponent(parsed.slug)}` : `code=${encodeURIComponent(parsed.code)}`;
      const res = await fetch(`/api/partners/attach?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, t("lookupFailed")));
      const data = (await res.json()) as { partner: Preview | null };
      setPreview(data.partner ?? "missing");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("lookupFailed"));
      setPreview(null);
    } finally {
      setLooking(false);
    }
  }, [parsed, t]);

  // Пришли с /p/<slug> — сразу показываем, кого подключаем.
  useEffect(() => {
    if (initialSlug) void lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug]);

  // Ввод меняется — прошлый предпросмотр больше не про него.
  useEffect(() => {
    setPreview((prev) => (prev && prev !== "missing" && parsed && "slug" in parsed && parsed.slug === prev.slug ? prev : null));
  }, [parsed]);

  const found = preview && preview !== "missing" ? preview : null;
  const canAttach = Boolean(found && found.active && !found.ownOrganization);

  async function attach() {
    if (!parsed) return;
    const res = await fetch("/api/partners/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed, accessLevel: level }),
    });
    if (!res.ok) {
      toast.error(await readError(res, t("attachFailed")));
      return;
    }
    const data = (await res.json()) as { brandName: string };
    setConfirmOpen(false);
    toast.success(t("attached", { name: data.brandName }));
    await onAttached();
  }

  return (
    <Card eyebrow={t("attachEyebrow")} title={t("attachTitle")}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          className={inputClass}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t("attachPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!parsed || looking} className={cn(btnPrimary, "h-11 shrink-0")}>
          {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {t("find")}
        </button>
      </form>
      {raw.trim() && !parsed ? (
        <p className="mt-2 text-[12px] text-[#a13a32]">{t("typo")}</p>
      ) : (
        <p className="mt-2 text-[12px] text-[#6f7282]">{t("attachHint")}</p>
      )}

      {preview === "missing" ? (
        <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fff4f2] px-4 py-3 text-[14px] text-[#a13a32]">
          {t("notFound")}
        </div>
      ) : null}

      {found ? (
        <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
              <Building2 className="size-5" />
            </span>
            <div className="text-[16px] font-semibold text-[#0b1024]">{found.brandName}</div>
            <span className="text-[13px] text-[#6f7282]">wesetup.ru/p/{found.slug}</span>
            {!found.active ? <Pill tone="warn">{t("partnerInactive")}</Pill> : null}
          </div>

          {found.ownOrganization ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-[#a13a32]">
              {t("ownOrg")}
            </p>
          ) : !found.active ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-[#a13a32]">
              {t("notActive")}
            </p>
          ) : (
            <>
              <div className="mt-4 text-[13px] font-medium text-[#3c4053]">{t("whichAccess", { name: found.brandName })}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("accessLabel")}>
                {LEVEL_OPTIONS.map((opt) => {
                  const active = level === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setLevel(opt.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-150",
                        active
                          ? "border-[#5566f6] bg-white ring-4 ring-[#5566f6]/10"
                          : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl",
                          active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]",
                        )}
                      >
                        <opt.icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-[#0b1024]">
                          {levelLabel(t, opt.value)}
                          {opt.value === "view" ? <span className="ml-1.5 text-[12px] font-normal text-[#6f7282]">{t("byDefault")}</span> : null}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#6f7282]">{levelHint(t, opt.value)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canAttach} className={cn(btnPrimary, "mt-4")}>
                {t("attachButton", { name: found.brandName })}
                <ArrowRight className="size-4" />
              </button>
            </>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={attach}
        variant="info"
        title={found ? t("attachDialogTitle", { name: found.brandName }) : t("attachDialogTitleNoName")}
        description={t("attachDialogDescription", { level: levelLabel(t, level) })}
        bullets={[
          {
            label:
              level === "edit"
                ? t("attachBulletEdit")
                : t("attachBulletView"),
          },
          { label: t("attachBullet2") },
          { label: t("attachBullet3") },
          { label: t("attachBullet4") },
        ]}
        confirmLabel={t("attach")}
      />
    </Card>
  );
}
