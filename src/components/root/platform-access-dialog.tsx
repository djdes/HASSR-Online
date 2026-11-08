"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, ShieldCheck, TrendingUp, UserRound } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PLATFORM_SECTIONS, platformHomeHref, type PlatformScope, type PlatformSectionKey } from "@/lib/platform-access";
import type { RoleView } from "@/lib/platform-roles";
import { cn } from "@/lib/utils";

export type AccessSaved = {
  sections: PlatformSectionKey[];
  salesHead: boolean;
  roleId: string | null;
  roleTitle: string | null;
  scope: PlatformScope;
  title: string | null;
};

/**
 * Доступ человека к панели (только владелец): роль из «Ролей» или «свой
 * набор» разделов, и личная должность в подписи КП и писем. У роли разделы,
 * охват («все» / «свои клиенты») и РОП — её; у своего набора разделы
 * отмечаются вручную, РОП включается переключателем (нужен раздел «CRM»).
 * Используется в «Команде и доступах» и в карточке клиента.
 */
export function PlatformAccessDialog({
  open,
  onClose,
  user,
  initialSections,
  initialSalesHead = false,
  initialRoleId = null,
  initialTitle = null,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: { id: string; name: string };
  initialSections: readonly PlatformSectionKey[];
  initialSalesHead?: boolean;
  initialRoleId?: string | null;
  initialTitle?: string | null;
  onSaved: (saved: AccessSaved) => void;
}) {
  const t = useTranslations("rootPanel");
  const [roles, setRoles] = useState<RoleView[] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(initialRoleId);
  const [sections, setSections] = useState<PlatformSectionKey[]>([...initialSections]);
  const [salesHead, setSalesHead] = useState(initialSalesHead);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const hadAccess = initialSections.length > 0;

  useEffect(() => {
    let alive = true;
    fetch("/api/root/team/roles")
      .then((response) => response.json())
      .then((data: { roles?: RoleView[] }) => {
        if (alive) setRoles(data.roles ?? []);
      })
      .catch(() => {
        if (alive) setRoles([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const role = roles?.find((item) => item.id === roleId) ?? null;
  const effectiveSections = role ? role.sections : sections;
  const effectiveSalesHead = role ? role.salesHead : salesHead && sections.includes("crm");
  const scope: PlatformScope = role?.scope ?? "all";

  function toggle(key: PlatformSectionKey) {
    if (key === "crm" && sections.includes("crm")) setSalesHead(false);
    setSections((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function chooseCustom() {
    if (role) {
      // Свой набор начинается с разделов выбранной роли — удобно поправить одну галку.
      setSections([...role.sections]);
      setSalesHead(role.salesHead);
    }
    setRoleId(null);
  }

  function toggleSalesHead() {
    const next = !salesHead;
    setSalesHead(next);
    if (next) setSections((current) => (current.includes("crm") ? current : [...current, "crm"]));
  }

  async function save(revoke = false) {
    const body = revoke
      ? { sections: [], roleId: null, salesHead: false }
      : { sections: effectiveSections, roleId, salesHead: effectiveSalesHead, title: title.trim() || null };
    const response = await fetch(`/api/root/team/${encodeURIComponent(user.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      toast.error(data?.error ?? t("access.failed"));
      return;
    }
    toast.success(revoke ? t("access.revoked", { name: user.name }) : t("access.saved", { name: user.name }), {
      description: !revoke && !hadAccess ? t("access.refreshHint") : undefined,
    });
    onSaved(
      revoke
        ? { sections: [], salesHead: false, roleId: null, roleTitle: null, scope: "all", title: title.trim() || null }
        : { sections: [...effectiveSections], salesHead: effectiveSalesHead, roleId, roleTitle: role?.title ?? null, scope, title: title.trim() || null },
    );
    onClose();
  }

  const ordered = PLATFORM_SECTIONS.filter((section) => effectiveSections.includes(section.key));
  const home = PLATFORM_SECTIONS.find((section) => section.home === platformHomeHref({ superadmin: false, sections: effectiveSections }));

  return (
    <>
      <ConfirmDialog
        open={open && !revokeOpen}
        onClose={onClose}
        onConfirm={() => save()}
        title={t("access.title", { name: user.name })}
        description={t("access.description")}
        icon={ShieldCheck}
        confirmLabel={hadAccess ? t("access.update") : t("access.grant")}
        confirmDisabled={effectiveSections.length === 0 || roles === null}
        bullets={
          effectiveSections.length
            ? [
                { label: t("access.willSee", { sections: ordered.map((section) => t(`sections.${section.key}.title`)).join(", ") }) },
                ...(home ? [{ label: t("access.lands", { section: t(`sections.${home.key}.title`) }), tone: "info" as const }] : []),
                ...(scope === "own" ? [{ label: t("access.scopeOwnBullet"), tone: "info" as const }] : []),
                ...(effectiveSalesHead ? [{ label: t("access.salesHeadBullet"), tone: "info" as const }] : []),
                { label: t("access.ownerOnly"), tone: "warn" as const },
              ]
            : [{ label: t("access.nothing"), tone: "warn" as const }]
        }
      >
        <div className="space-y-4" data-platform-access-dialog>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.roleLabel")}</div>
            {roles === null ? (
              <p className="flex items-center gap-2 text-[13px] text-[#6f7282]">
                <Loader2 className="size-4 animate-spin" /> {t("access.loadingRoles")}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((item) => {
                  const active = roleId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRoleId(item.id)}
                      aria-pressed={active}
                      data-role={item.key}
                      className={cn(
                        "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                        active ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                        {active ? <Check className="size-4 text-[#5566f6]" /> : null}
                        {item.title}
                        {item.salesHead ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[#eef1ff] px-1.5 text-[11px] font-medium text-[#3848c7]">
                            <TrendingUp className="size-3" />
                            {t("access.salesHeadBadge")}
                          </span>
                        ) : null}
                        {item.scope === "own" ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[#fff8eb] px-1.5 text-[11px] font-medium text-[#7a4a00]">
                            <UserRound className="size-3" />
                            {t("access.scopeOwnBadge")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">
                        {item.sections.length === PLATFORM_SECTIONS.length ? t("team.allSections") : item.sections.map((key) => t(`sections.${key}.title`)).join(" · ")}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={chooseCustom}
                  aria-pressed={roleId === null}
                  data-role="custom"
                  className={cn(
                    "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                    roleId === null ? "border-[#5566f6] bg-[#f5f6ff]" : "border-dashed border-[#dcdfed] bg-white hover:border-[#5566f6]/40",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                    {roleId === null ? <Check className="size-4 text-[#5566f6]" /> : null}
                    {t("access.customRole")}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">{t("access.customRoleHint")}</span>
                </button>
              </div>
            )}
          </div>

          {roleId === null ? (
            <>
              <div>
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.sectionsLabel")}</div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {PLATFORM_SECTIONS.map((section) => {
                    const checked = sections.includes(section.key);
                    return (
                      <label
                        key={section.key}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors duration-150",
                          checked ? "border-[#5566f6]/50 bg-[#f5f6ff]" : "border-[#ececf4] hover:bg-[#fafbff]",
                        )}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggle(section.key)} data-section={section.key} className="mt-0.5 size-4 accent-[#5566f6]" />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium text-[#0b1024]">{t(`sections.${section.key}.title`)}</span>
                          <span className="block text-[12px] leading-snug text-[#6f7282]">{t(`sections.${section.key}.hint`)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 transition-colors duration-150",
                  salesHead ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
                )}
                data-sales-head-toggle
              >
                <input type="checkbox" checked={salesHead} onChange={toggleSalesHead} className="mt-0.5 size-4 accent-[#5566f6]" data-sales-head />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                    <TrendingUp className="size-4 text-[#5566f6]" />
                    {t("access.salesHeadTitle")}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">{t("access.salesHeadHint")}</span>
                </span>
              </label>
            </>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.titleLabel")}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder={role?.signatureTitle || role?.title || t("access.titlePlaceholder")}
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              data-access-title
            />
            <span className="mt-1 block text-[12px] text-[#9b9fb3]">{t("access.titleHint")}</span>
          </label>

          {hadAccess ? (
            <button type="button" onClick={() => setRevokeOpen(true)} className="text-[13px] font-medium text-[#a13a32] transition-colors hover:text-[#7f2b25]">
              {t("access.revoke")}
            </button>
          ) : null}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={open && revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onConfirm={() => save(true)}
        variant="danger"
        title={t("access.revokeTitle")}
        description={t("access.revokeBody", { name: user.name })}
        confirmLabel={t("access.revoke")}
      />
    </>
  );
}
