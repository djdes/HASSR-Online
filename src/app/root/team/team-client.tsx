"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Crown, Loader2, Mail, Phone, Search, ShieldCheck, UserPlus } from "lucide-react";
import { PlatformAccessDialog } from "@/components/root/platform-access-dialog";
import { PLATFORM_PRESETS, PLATFORM_SECTIONS, matchPlatformPreset, type PlatformSectionKey } from "@/lib/platform-access";
import type { MailSenderStatus } from "@/lib/platform-mail";
import type { PlatformMember, TeamCandidate } from "@/lib/platform-team.server";
import { cn } from "@/lib/utils";

const MAIL_TONE: Record<MailSenderStatus, string> = {
  none: "bg-[#f5f6ff] text-[#6f7282]",
  unverified: "bg-[#fff8eb] text-[#7a4a00]",
  verified: "bg-[#ecfdf5] text-[#116b2a]",
  disabled: "bg-[#f5f6ff] text-[#6f7282]",
  error: "bg-[#fff4f2] text-[#a13a32]",
};

export function TeamClient({ initialMembers }: { initialMembers: PlatformMember[] }) {
  const t = useTranslations("rootPanel");
  const locale = useLocale();
  const [members, setMembers] = useState(initialMembers);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<TeamCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; sections: PlatformSectionKey[]; member?: PlatformMember; candidate?: TeamCandidate } | null>(null);

  // Debounced search: people appear as you type, no extra button.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setCandidates(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/root/team?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = (await response.json()) as { candidates?: TeamCandidate[] };
        setCandidates(data.candidates ?? []);
      } catch {
        /* aborted */
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  function roleLabel(sections: readonly PlatformSectionKey[], owner: boolean) {
    if (owner) return t("access.ownerBadge");
    const preset = matchPlatformPreset(sections);
    return preset ? t(`presets.${preset}.title`) : t("presets.custom.title");
  }

  function applySaved(userId: string, sections: PlatformSectionKey[]) {
    setMembers((current) => {
      const existing = current.find((member) => member.id === userId);
      if (!sections.length) return current.filter((member) => member.id !== userId || member.owner);
      if (existing) return current.map((member) => (member.id === userId ? { ...member, sections, grantedAt: new Date().toISOString() } : member));
      const candidate = editing?.candidate;
      if (!candidate) return current;
      return [
        ...current,
        {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          organizationId: "",
          organizationName: candidate.organizationName,
          owner: false,
          sections,
          grantedAt: new Date().toISOString(),
          mail: "none",
          lastLoginAt: null,
        },
      ];
    });
    setCandidates((current) => current?.map((item) => (item.id === userId ? { ...item, sections } : item)) ?? null);
  }

  const staffCount = useMemo(() => members.filter((member) => !member.owner).length, [members]);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6" data-team-add>
          <div className="flex items-center gap-2 text-[16px] font-semibold text-[#0b1024]">
            <UserPlus className="size-4 text-[#5566f6]" />
            {t("team.addTitle")}
          </div>
          <p className="mt-1 text-[13px] text-[#6f7282]">{t("team.addHint")}</p>
          <label className="relative mt-4 block">
            <span className="sr-only">{t("team.searchLabel")}</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("team.searchPlaceholder")}
              data-team-search
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-10 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
            {searching ? <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#9b9fb3]" /> : null}
          </label>
          {candidates ? (
            candidates.length ? (
              <ul className="mt-3 divide-y divide-[#eef0f6] rounded-2xl border border-[#ececf4]">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-team-candidate={candidate.id}>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-[#0b1024]">{candidate.name}</div>
                      <div className="truncate text-[12.5px] text-[#6f7282]">
                        {[candidate.email, candidate.phone, t("team.cabinet", { name: candidate.organizationName })].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {candidate.owner ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] font-medium text-[#7a4a00]">
                        <Crown className="size-3.5" />
                        {t("access.ownerBadge")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing({ id: candidate.id, name: candidate.name, sections: candidate.sections, candidate })}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
                      >
                        <ShieldCheck className="size-4" />
                        {candidate.sections.length ? t("access.buttonHas", { role: roleLabel(candidate.sections, false) }) : t("access.button")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">{t("team.noResults")}</p>
            )
          ) : null}
        </section>

        <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]" data-team-members>
          <div className="flex items-baseline justify-between gap-3 border-b border-[#eef0f6] px-5 py-4 md:px-6">
            <span className="text-[16px] font-semibold text-[#0b1024]">{t("team.membersTitle")}</span>
            <span className="text-[13px] tabular-nums text-[#6f7282]">{t("team.membersCount", { count: members.length })}</span>
          </div>
          <ul className="divide-y divide-[#eef0f6]">
            {members.map((member) => (
              <li key={member.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_250px] md:items-center md:px-6" data-team-member={member.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-medium text-[#0b1024]">{member.name}</span>
                    {member.owner ? <Crown className="size-4 shrink-0 text-[#d4a017]" aria-label={t("access.ownerBadge")} /> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-[#6f7282]">
                    {member.email ? (
                      <a href={`mailto:${member.email}`} className="inline-flex items-center gap-1 hover:text-[#3848c7]">
                        <Mail className="size-3.5" />
                        {member.email}
                      </a>
                    ) : null}
                    {member.phone ? (
                      <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1 hover:text-[#3848c7]">
                        <Phone className="size-3.5" />
                        {member.phone}
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#9b9fb3]">
                    {member.lastLoginAt ? t("team.lastLogin", { date: date(member.lastLoginAt) }) : t("team.neverLoggedIn")}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-[#3848c7]">{roleLabel(member.sections, member.owner)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {member.owner ? (
                      <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] text-[#3848c7]">{t("team.allSections")}</span>
                    ) : (
                      PLATFORM_SECTIONS.filter((section) => member.sections.includes(section.key)).map((section) => (
                        <span key={section.key} className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] text-[#3848c7]">
                          {t(`sections.${section.key}.title`)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium", MAIL_TONE[member.mail])} title={t("team.mail")}>
                    <Mail className="mr-1 inline size-3.5" />
                    {t(`team.mailStatus.${member.mail}`)}
                  </span>
                  {member.owner ? null : (
                    <button
                      type="button"
                      onClick={() => setEditing({ id: member.id, name: member.name, sections: member.sections, member })}
                      className="inline-flex h-9 items-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    >
                      {t("team.edit")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {staffCount === 0 ? <p className="px-5 pb-5 text-[13px] text-[#6f7282] md:px-6">{t("team.empty")}</p> : null}
        </section>
      </div>

      <aside className="h-fit rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 lg:sticky lg:top-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("team.rolesTitle")}</div>
        <ul className="mt-3 space-y-3">
          {PLATFORM_PRESETS.map((preset) => (
            <li key={preset.key}>
              <div className="text-[14px] font-medium text-[#0b1024]">{t(`presets.${preset.key}.title`)}</div>
              <div className="text-[12.5px] leading-snug text-[#6f7282]">
                {preset.key === "admin" ? t(`presets.admin.hint`) : preset.sections.map((key) => t(`sections.${key}.title`)).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-[#ececf4] pt-3 text-[12px] leading-snug text-[#6f7282]">{t("access.ownerOnly")}</p>
      </aside>

      {editing ? (
        <PlatformAccessDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          user={{ id: editing.id, name: editing.name }}
          initialSections={editing.sections}
          onSaved={(sections) => applySaved(editing.id, sections)}
        />
      ) : null}
    </div>
  );
}
