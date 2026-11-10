"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgePercent, Pencil, Plus, ShieldCheck, Trash2, TrendingUp, UserRound } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PLATFORM_SECTIONS, type PlatformScope, type PlatformSectionKey } from "@/lib/platform-access";
import type { RoleView } from "@/lib/platform-roles";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  title: string;
  description: string;
  sections: PlatformSectionKey[];
  scope: PlatformScope;
  salesHead: boolean;
  signatureTitle: string;
  /** Лимит скидки строкой: пусто — по умолчанию роли. */
  discountLimit: string;
  defaultDiscount: number;
};

const EMPTY: Draft = { id: null, title: "", description: "", sections: ["crm", "clients"], scope: "own", salesHead: false, signatureTitle: "", discountLimit: "", defaultDiscount: 0 };

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";

/**
 * «Роли» в «Команде и доступах» (только владелец): разделы, охват данных
 * («все» / «свои клиенты и лиды»), РОП и должность в подписи. Изменение роли
 * сразу меняет доступ всех её людей (сервер переписывает им разделы и РОП).
 */
export function RolesPanel({ roles, onChange }: { roles: RoleView[]; onChange: (roles: RoleView[]) => void }) {
  const t = useTranslations("rootPanel");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);

  function edit(role: RoleView) {
    setDraft({
      id: role.id,
      title: role.title,
      description: role.description ?? "",
      sections: [...role.sections],
      scope: role.scope,
      salesHead: role.salesHead,
      signatureTitle: role.signatureTitle ?? "",
      discountLimit: role.discountLimit === null ? "" : String(role.discountLimit),
      defaultDiscount: role.defaultDiscount,
    });
  }

  function toggleSection(key: PlatformSectionKey) {
    setDraft((current) => {
      if (!current) return current;
      const has = current.sections.includes(key);
      return {
        ...current,
        sections: has ? current.sections.filter((item) => item !== key) : [...current.sections, key],
        salesHead: key === "crm" && has ? false : current.salesHead,
      };
    });
  }

  async function save() {
    if (!draft) return;
    const response = await fetch(draft.id ? `/api/root/team/roles/${encodeURIComponent(draft.id)}` : "/api/root/team/roles", {
      method: draft.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description || null,
        sections: draft.sections,
        scope: draft.scope,
        salesHead: draft.salesHead,
        signatureTitle: draft.signatureTitle || null,
        discountLimit: draft.discountLimit === "" ? null : Math.min(90, Number(draft.discountLimit) || 0),
      }),
    });
    const data = (await response.json().catch(() => null)) as { role?: RoleView; error?: string } | null;
    if (!response.ok || !data?.role) {
      toast.error(data?.error ?? t("roles.failed"));
      return;
    }
    const saved = data.role;
    onChange(draft.id ? roles.map((role) => (role.id === saved.id ? { ...saved, members: role.members } : role)) : [...roles, saved]);
    toast.success(t("roles.saved", { name: saved.title }));
    setDraft(null);
  }

  async function remove(role: RoleView) {
    const response = await fetch(`/api/root/team/roles/${encodeURIComponent(role.id)}`, { method: "DELETE" });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      toast.error(data?.error ?? t("roles.failed"));
      return;
    }
    onChange(roles.filter((item) => item.id !== role.id));
    toast.success(t("roles.deleted"));
    setDeleting(null);
  }

  return (
    <section className="h-fit rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 lg:sticky lg:top-6" data-team-roles>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("roles.title")}</div>
        <button
          type="button"
          onClick={() => setDraft({ ...EMPTY })}
          className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] hover:border-[#5566f6]/40"
          data-role-add
        >
          <Plus className="size-3.5" />
          {t("roles.add")}
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-[#6f7282]">{t("roles.hint")}</p>
      <ul className="mt-3 space-y-2">
        {roles.map((role) => (
          <li key={role.id} className="rounded-2xl border border-[#ececf4] bg-white px-3 py-2.5" data-role-row={role.key}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                  {role.title}
                  {role.salesHead ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[#eef1ff] px-1.5 text-[11px] font-medium text-[#3848c7]">
                      <TrendingUp className="size-3" />
                      {t("access.salesHeadBadge")}
                    </span>
                  ) : null}
                  {role.scope === "own" ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[#fff8eb] px-1.5 text-[11px] font-medium text-[#7a4a00]">
                      <UserRound className="size-3" />
                      {t("access.scopeOwnBadge")}
                    </span>
                  ) : null}
                  {(role.discountLimit ?? role.defaultDiscount) > 0 ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[#eef8f0] px-1.5 text-[11px] font-medium text-[#116b2a]" data-role-discount-badge>
                      <BadgePercent className="size-3" />
                      {t("roles.discountBadge", { percent: String(role.discountLimit ?? role.defaultDiscount) })}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">
                  {role.sections.length === PLATFORM_SECTIONS.length ? t("team.allSections") : role.sections.map((key) => t(`sections.${key}.title`)).join(" · ")}
                </div>
                <div className="mt-0.5 text-[11.5px] text-[#9b9fb3]">
                  {t("roles.members", { count: role.members })}
                  {role.system ? ` · ${t("roles.system")}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => edit(role)} className="rounded-lg p-1.5 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#3848c7]" aria-label={t("roles.edit")}>
                  <Pencil className="size-4" />
                </button>
                {!role.system && role.members === 0 ? (
                  <button type="button" onClick={() => setDeleting(role)} className="rounded-lg p-1.5 text-[#9b9fb3] hover:bg-[#fff4f2] hover:text-[#a13a32]" aria-label={t("roles.delete")}>
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-[#ececf4] pt-3 text-[12px] leading-snug text-[#6f7282]">{t("access.ownerOnly")}</p>

      {draft ? (
        <ConfirmDialog
          open
          onClose={() => setDraft(null)}
          onConfirm={save}
          title={draft.id ? t("roles.formTitleEdit", { name: draft.title }) : t("roles.formTitleNew")}
          icon={ShieldCheck}
          confirmLabel={t("access.update")}
          confirmDisabled={draft.title.trim().length < 2 || draft.sections.length === 0}
        >
          <div className="space-y-4" data-role-form>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[13px] text-[#3c4053]">
                {t("roles.nameLabel")}
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={cn(INPUT, "mt-1")} maxLength={80} data-role-title />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                {t("roles.signatureLabel")}
                <input
                  value={draft.signatureTitle}
                  onChange={(event) => setDraft({ ...draft, signatureTitle: event.target.value })}
                  placeholder={t("roles.signaturePlaceholder")}
                  className={cn(INPUT, "mt-1")}
                  maxLength={120}
                />
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                {t("roles.discountLabel")}
                <input
                  value={draft.discountLimit}
                  onChange={(event) => setDraft({ ...draft, discountLimit: event.target.value.replace(/\D/g, "").slice(0, 2) })}
                  placeholder={t("roles.discountPlaceholder", { percent: String(draft.defaultDiscount) })}
                  className={cn(INPUT, "mt-1")}
                  inputMode="numeric"
                  data-role-discount
                />
                <span className="mt-1 block text-[12px] text-[#9b9fb3]">{t("roles.discountHint")}</span>
              </label>
              <label className="block text-[13px] text-[#3c4053]">
                {t("roles.descriptionLabel")}
                <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={cn(INPUT, "mt-1")} maxLength={300} />
              </label>
            </div>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("roles.scopeLabel")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["all", "own"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setDraft({ ...draft, scope })}
                    aria-pressed={draft.scope === scope}
                    data-role-scope={scope}
                    className={cn(
                      "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150",
                      draft.scope === scope ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:border-[#5566f6]/40",
                    )}
                  >
                    <span className="block text-[14px] font-medium text-[#0b1024]">{scope === "all" ? t("roles.scopeAll") : t("roles.scopeOwn")}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">{scope === "all" ? t("roles.scopeAllHint") : t("roles.scopeOwnHint")}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.sectionsLabel")}</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {PLATFORM_SECTIONS.map((section) => {
                  const checked = draft.sections.includes(section.key);
                  return (
                    <label
                      key={section.key}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors duration-150",
                        checked ? "border-[#5566f6]/50 bg-[#f5f6ff]" : "border-[#ececf4] hover:bg-[#fafbff]",
                      )}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleSection(section.key)} className="mt-0.5 size-4 accent-[#5566f6]" data-role-section={section.key} />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium text-[#0b1024]">{t(`sections.${section.key}.title`)}</span>
                        <span className="block text-[12px] leading-snug text-[#6f7282]">{t(`sections.${section.key}.hint`)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3", draft.salesHead ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4]")}>
              <input
                type="checkbox"
                checked={draft.salesHead}
                onChange={() =>
                  setDraft({
                    ...draft,
                    salesHead: !draft.salesHead,
                    sections: !draft.salesHead && !draft.sections.includes("crm") ? [...draft.sections, "crm"] : draft.sections,
                  })
                }
                className="mt-0.5 size-4 accent-[#5566f6]"
                data-role-sales-head
              />
              <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-[#0b1024]">
                <TrendingUp className="size-4 text-[#5566f6]" />
                {t("roles.salesHeadToggle")}
              </span>
            </label>
          </div>
        </ConfirmDialog>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
          variant="danger"
          title={t("roles.deleteTitle", { name: deleting.title })}
          description={t("roles.deleteBody")}
          confirmLabel={t("roles.delete")}
        />
      ) : null}
    </section>
  );
}
