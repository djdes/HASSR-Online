"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Library, Loader2, Mail, Plus, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ACCESS_EMAIL_RE,
  groupAccessCandidates,
  type AccessCandidate,
  type AccessOrganization,
  type AccessPerson,
  type CabinetAccess,
} from "@/lib/master-cabinet-access-view";
import { cn } from "@/lib/utils";

export type AccessData = {
  cabinets: CabinetAccess[];
  candidates: AccessCandidate[];
  organizations: AccessOrganization[];
};

/** «Права доступа» — `/api/settings/master-cabinets/access`; в самом кабинете — `/api/master/access`. */
export const SETTINGS_ACCESS_ENDPOINT = "/api/settings/master-cabinets/access";
type ApiResponse = {
  error?: string;
  access?: AccessData;
  inviteUrl?: string;
  emailSent?: boolean;
  user?: { email: string };
};

const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6 md:p-7";
const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

async function callAccessApi(
  endpoint: string,
  method: "POST" | "DELETE",
  body: Record<string, unknown>,
  fallbackError: string
): Promise<ApiResponse | null> {
  const response = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as ApiResponse | null;
  if (!response?.ok) {
    toast.error(json?.error ?? fallbackError);
    return null;
  }
  return json;
}

/**
 * «Права доступа → Мастер-кабинеты» (только владелец аккаунта): у каждого
 * кабинета свой список людей. Пригласить по почте — человек станет
 * сотрудником выбранной организации в группе «Мастер-кабинет»; дать доступ
 * сотруднику объекта — кабинет появится у него в меню профиля, его обычные
 * права не меняются.
 */
export function MasterCabinetAccessCard({ initial }: { initial: AccessData }) {
  const t = useTranslations("masterUi.masterCabinetAccessCard");
  const [access, setAccess] = useState<AccessData>(initial);

  return (
    <section id="master-cabinets" className={CARD} aria-labelledby="master-cabinets-title">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Library className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="master-cabinets-title" className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </h2>
          <p className="mt-1 max-w-[680px] text-[13px] leading-[1.55] text-[#6f7282]">
            {t("intro")}
          </p>
        </div>
      </div>

      {access.cabinets.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.55] text-[#6f7282]">
            {t("emptyHint")}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {access.cabinets.map((cabinet) => (
            <CabinetAccessBlock
              key={cabinet.id}
              endpoint={SETTINGS_ACCESS_ENDPOINT}
              cabinet={cabinet}
              candidates={access.candidates}
              onChange={setAccess}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Люди одного кабинета: список, «Пригласить по почте», «Дать доступ сотруднику», «Убрать». */
export function CabinetAccessBlock({
  endpoint,
  cabinet,
  candidates,
  onChange,
}: {
  endpoint: string;
  cabinet: CabinetAccess;
  candidates: AccessCandidate[];
  onChange: (next: AccessData) => void;
}) {
  const t = useTranslations("masterUi.masterCabinetAccessCard");
  const [mode, setMode] = useState<null | "invite" | "grant">(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ email: string; url: string; emailSent: boolean } | null>(null);
  const [removing, setRemoving] = useState<AccessPerson | null>(null);

  const groups = useMemo(
    () => groupAccessCandidates(candidates, cabinet.people.map((person) => person.userId), query),
    [candidates, cabinet.people, query]
  );
  const inviteValid = name.replace(/\s+/g, " ").trim().length >= 2 && ACCESS_EMAIL_RE.test(email.trim());

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteValid || busy) return;
    setBusy(true);
    const json = await callAccessApi(endpoint, "POST", { action: "invite", cabinetId: cabinet.id, name, email }, t("apiFallbackError"));
    setBusy(false);
    if (!json?.access || !json.inviteUrl) return;
    onChange(json.access);
    setLastInvite({ email: json.user?.email ?? email.trim(), url: json.inviteUrl, emailSent: json.emailSent !== false });
    toast.success(t("inviteReady", { email: json.user?.email ?? email.trim() }));
    setName("");
    setEmail("");
    setMode(null);
  }

  async function grant(candidate: AccessCandidate) {
    if (grantingId) return;
    setGrantingId(candidate.id);
    const json = await callAccessApi(endpoint, "POST", { action: "grant", cabinetId: cabinet.id, userId: candidate.id }, t("apiFallbackError"));
    setGrantingId(null);
    if (!json?.access) return;
    onChange(json.access);
    // Список остаётся открытым — можно сразу добавить следующего; поиск сброшен.
    setQuery("");
    toast.success(t("accessGranted", { name: candidate.name }), {
      description: t("accessGrantedDescription", { cabinetName: cabinet.name }),
    });
  }

  async function revoke() {
    if (!removing) return;
    const json = await callAccessApi(endpoint, "DELETE", { cabinetId: cabinet.id, userId: removing.userId }, t("apiFallbackError"));
    if (!json?.access) return;
    onChange(json.access);
    toast.success(t("accessRevoked", { name: removing.name }));
    setRemoving(null);
  }

  function copyInvite(url: string) {
    void navigator.clipboard?.writeText(url).then(
      () => toast.success(t("inviteLinkCopied")),
      () => toast.error(t("copyFailed"))
    );
  }

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 sm:p-5" data-testid="cabinet-access">
      <div className="flex flex-wrap items-center gap-2">
        <Library className="size-4 shrink-0 text-[#5566f6]" />
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#0b1024]" data-testid="cabinet-access-name">
          {cabinet.name}
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium tabular-nums text-[#3848c7] ring-1 ring-[#ececf4]">
          {t("peopleCount", { count: cabinet.people.length })}
        </span>
      </div>

      {cabinet.people.length > 0 ? (
        <ul className="mt-3 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4] bg-white">
          {cabinet.people.map((person) => (
            <li key={person.userId} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="cabinet-access-person">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
                {initialsOf(person.name || person.email)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-[#0b1024]">{person.name}</span>
                <span className="block truncate text-[12.5px] text-[#6f7282]">
                  {person.kind === "member"
                    ? [person.organizationName, person.title].filter(Boolean).join(" · ")
                    : t("onlyThisCabinet", { email: person.email })}
                </span>
              </span>
              {person.kind === "member" && !person.pending ? (
                <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
                  {t("roleEmployee")}
                </span>
              ) : person.pending ? (
                <span className="shrink-0 rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] font-medium text-[#9a4a06]">
                  {t("roleInvited")}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
                  <Check className="size-3.5" />
                  {t("roleJoined")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setRemoving(person)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15"
                data-testid="cabinet-access-remove"
              >
                <UserMinus className="size-3.5" />
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-[#dcdfed] bg-white px-4 py-3 text-[13px] text-[#6f7282]">
          {t("ownerOnly")}
        </p>
      )}

      {lastInvite ? (
        <div
          className={cn(
            "mt-3 space-y-2.5 rounded-2xl border p-4",
            lastInvite.emailSent ? "border-[#c9f0da] bg-[#ecfdf5]" : "border-[#ffe2b8] bg-[#fff8eb]"
          )}
          data-testid="cabinet-access-invite-result"
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
                ? t("inviteSent", { email: lastInvite.email })
                : t("inviteNotSent", { email: lastInvite.email })}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={lastInvite.url}
              onFocus={(event) => event.currentTarget.select()}
              aria-label={t("inviteLinkLabel")}
              className="h-10 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-3 font-mono text-[12.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <button type="button" onClick={() => copyInvite(lastInvite.url)} className={OUTLINE}>
              <Copy className="size-4 text-[#5566f6]" />
              {t("copy")}
            </button>
          </div>
          <p className="text-[12px] text-[#6f7282]">{t("linkValidity")}</p>
        </div>
      ) : null}

      {mode === "invite" ? (
        <form onSubmit={invite} className="mt-3 space-y-3 rounded-2xl border border-[#ececf4] bg-white p-4">
          <div className="text-[13px] leading-[1.5] text-[#3c4053]">
            {t("inviteForm.description", { cabinetName: cabinet.name })}
          </div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("inviteForm.namePlaceholder")}
            autoComplete="name"
            autoFocus
            disabled={busy}
            className={INPUT}
            data-testid="cabinet-access-invite-name"
          />
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            disabled={busy}
            className={INPUT}
            data-testid="cabinet-access-invite-email"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={!inviteValid || busy}
              className={cn(PRIMARY, "w-full sm:w-auto")}
              data-testid="cabinet-access-invite-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              {t("inviteForm.submit")}
            </button>
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={cn(OUTLINE, "h-11 w-full sm:w-auto")}>
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {mode === "grant" ? (
        <div className="mt-3 rounded-2xl border border-[#ececf4] bg-white p-3" data-testid="cabinet-access-picker">
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("picker.searchPlaceholder")}
                autoFocus
                className={cn(INPUT, "pl-10")}
                aria-label={t("picker.searchLabel")}
                data-testid="cabinet-access-search"
              />
            </label>
            <button
              type="button"
              onClick={() => setMode(null)}
              aria-label={t("picker.close")}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {groups.recommended.length + groups.other.length === 0 ? (
              <p className="px-2 py-4 text-center text-[13px] text-[#6f7282]">
                {query.trim() ? t("picker.nobodyFound") : t("picker.everyoneHasAccess")}
              </p>
            ) : (
              <>
                <CandidateGroup
                  title={t("picker.recommended")}
                  items={groups.recommended}
                  grantingId={grantingId}
                  onPick={grant}
                />
                <CandidateGroup title={t("picker.others")} items={groups.other} grantingId={grantingId} onPick={grant} />
              </>
            )}
          </div>
        </div>
      ) : null}

      {mode === null ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => {
              setMode("invite");
              setLastInvite(null);
            }}
            className={cn(OUTLINE, "w-full sm:w-auto")}
            data-testid="cabinet-access-invite"
          >
            <Mail className="size-4 text-[#5566f6]" />
            {t("inviteByEmail")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("grant");
              setQuery("");
            }}
            className={cn(OUTLINE, "w-full sm:w-auto")}
            data-testid="cabinet-access-grant"
          >
            <UserPlus className="size-4 text-[#5566f6]" />
            {t("grantToEmployee")}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={revoke}
        variant="warn"
        icon={UserMinus}
        title={t("confirm.title", { cabinetName: cabinet.name })}
        description={removing ? t("confirm.description", { name: removing.name }) : undefined}
        confirmLabel={t("confirm.confirmLabel")}
        bullets={
          removing?.kind === "member"
            ? [
                { label: t("confirm.memberBullet1") },
                {
                  label: t("confirm.memberBullet2"),
                  tone: "info",
                },
                { label: t("confirm.memberBullet3") },
              ]
            : [
                { label: t("confirm.guestBullet1") },
                { label: t("confirm.guestBullet2"), tone: "info" },
                { label: t("confirm.guestBullet3") },
              ]
        }
      />
    </div>
  );
}

function CandidateGroup({
  title,
  items,
  grantingId,
  onPick,
}: {
  title: string;
  items: AccessCandidate[];
  grantingId: string | null;
  onPick: (candidate: AccessCandidate) => void;
}) {
  const t = useTranslations("masterUi.masterCabinetAccessCard");
  if (items.length === 0) return null;
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
        <Users className="size-3.5" />
        {title}
      </div>
      {items.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          onClick={() => onPick(candidate)}
          disabled={grantingId !== null}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:bg-[#f5f6ff] focus-visible:outline-none disabled:opacity-60"
          data-testid="cabinet-access-candidate"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
            {initialsOf(candidate.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-[#0b1024]">{candidate.name}</span>
            <span className="block truncate text-[12.5px] text-[#6f7282]">
              {[candidate.organizationName, candidate.title].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[#3848c7]">
            {grantingId === candidate.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            <span className="hidden sm:inline">{t("grantAccess")}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
