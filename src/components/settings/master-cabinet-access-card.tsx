"use client";

import { useMemo, useState } from "react";
import { Building2, Check, Copy, Library, Loader2, Mail, Plus, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ACCESS_EMAIL_RE,
  defaultInviteOrganization,
  groupAccessCandidates,
  type AccessCandidate,
  type AccessOrganization,
  type AccessPerson,
  type CabinetAccess,
} from "@/lib/master-cabinet-access-view";
import { pluralRu } from "@/lib/plural-ru";
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
  body: Record<string, unknown>
): Promise<ApiResponse | null> {
  const response = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as ApiResponse | null;
  if (!response?.ok) {
    toast.error(json?.error ?? "Не получилось. Проверьте интернет и попробуйте ещё раз.");
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
  const [access, setAccess] = useState<AccessData>(initial);

  return (
    <section id="master-cabinets" className={CARD} aria-labelledby="master-cabinets-title">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Library className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="master-cabinets-title" className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Мастер-кабинеты
          </h2>
          <p className="mt-1 max-w-[680px] text-[13px] leading-[1.55] text-[#6f7282]">
            Кто ведёт меню и сырьё. Все, у кого есть доступ, — сотрудники ваших организаций: приглашённый по почте
            появится в «Сотрудниках» выбранной организации в группе «Мастер-кабинет» (права группы — выше на этой
            странице). Уже заведённому сотруднику доступ даётся одним выбором. У владельца аккаунта доступ есть всегда.
          </p>
        </div>
      </div>

      {access.cabinets.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">Мастер-кабинетов пока нет</div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.55] text-[#6f7282]">
            Создайте его: меню профиля (кружок с инициалами справа вверху) → раздел «Кабинет» → «Создать
            мастер-кабинет». Потом здесь можно будет выдать доступ.
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
              organizations={access.organizations}
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
  organizations,
  onChange,
}: {
  endpoint: string;
  cabinet: CabinetAccess;
  candidates: AccessCandidate[];
  organizations: AccessOrganization[];
  onChange: (next: AccessData) => void;
}) {
  const [mode, setMode] = useState<null | "invite" | "grant">(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState(() => defaultInviteOrganization(organizations, cabinet.code));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ email: string; url: string; emailSent: boolean } | null>(null);
  const [removing, setRemoving] = useState<AccessPerson | null>(null);

  const groups = useMemo(
    () => groupAccessCandidates(candidates, cabinet.people.map((person) => person.userId), query),
    [candidates, cabinet.people, query]
  );
  const inviteValid =
    name.replace(/\s+/g, " ").trim().length >= 2 && ACCESS_EMAIL_RE.test(email.trim()) && Boolean(organizationId);
  const inviteOrganization = organizations.find((org) => org.id === organizationId) ?? null;

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteValid || busy) return;
    setBusy(true);
    const json = await callAccessApi(endpoint, "POST", { action: "invite", cabinetId: cabinet.id, organizationId, name, email });
    setBusy(false);
    if (!json?.access || !json.inviteUrl) return;
    onChange(json.access);
    setLastInvite({ email: json.user?.email ?? email.trim(), url: json.inviteUrl, emailSent: json.emailSent !== false });
    toast.success(`Приглашение готово: ${json.user?.email ?? email.trim()}`);
    setName("");
    setEmail("");
    setMode(null);
  }

  async function grant(candidate: AccessCandidate) {
    if (grantingId) return;
    setGrantingId(candidate.id);
    const json = await callAccessApi(endpoint, "POST", { action: "grant", cabinetId: cabinet.id, userId: candidate.id });
    setGrantingId(null);
    if (!json?.access) return;
    onChange(json.access);
    // Список остаётся открытым — можно сразу добавить следующего; поиск сброшен.
    setQuery("");
    toast.success(`Доступ открыт: ${candidate.name}`, {
      description: `Кабинет «${cabinet.name}» — в его меню профиля, раздел «Кабинет».`,
    });
  }

  async function revoke() {
    if (!removing) return;
    const json = await callAccessApi(endpoint, "DELETE", { cabinetId: cabinet.id, userId: removing.userId });
    if (!json?.access) return;
    onChange(json.access);
    toast.success(`Доступ убран: ${removing.name}`);
    setRemoving(null);
  }

  function copyInvite(url: string) {
    void navigator.clipboard?.writeText(url).then(
      () => toast.success("Ссылка приглашения скопирована"),
      () => toast.error("Не удалось скопировать — выделите и скопируйте вручную")
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
          {cabinet.people.length} {pluralRu(cabinet.people.length, "человек", "человека", "человек")}
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
                    : `${person.email} · только этот кабинет`}
                </span>
              </span>
              {person.kind === "member" && !person.pending ? (
                <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
                  Сотрудник
                </span>
              ) : person.pending ? (
                <span className="shrink-0 rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] font-medium text-[#9a4a06]">
                  Приглашён
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
                  <Check className="size-3.5" />
                  Вошёл
                </span>
              )}
              <button
                type="button"
                onClick={() => setRemoving(person)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15"
                data-testid="cabinet-access-remove"
              >
                <UserMinus className="size-3.5" />
                Убрать
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-[#dcdfed] bg-white px-4 py-3 text-[13px] text-[#6f7282]">
          Пока доступ только у владельца аккаунта.
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
                ? `Приглашение отправлено на ${lastInvite.email}. По ссылке человек задаст пароль и сразу попадёт в кабинет${inviteOrganization ? `; в «Сотрудниках» — «${inviteOrganization.name}»` : ""}.`
                : `Письмо на ${lastInvite.email} не ушло — отправьте ссылку сами`}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={lastInvite.url}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Ссылка приглашения"
              className="h-10 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-3 font-mono text-[12.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <button type="button" onClick={() => copyInvite(lastInvite.url)} className={OUTLINE}>
              <Copy className="size-4 text-[#5566f6]" />
              Скопировать
            </button>
          </div>
          <p className="text-[12px] text-[#6f7282]">Ссылка действует 7 дней.</p>
        </div>
      ) : null}

      {mode === "invite" ? (
        <form onSubmit={invite} className="mt-3 space-y-3 rounded-2xl border border-[#ececf4] bg-white p-4">
          <div className="text-[13px] leading-[1.5] text-[#3c4053]">
            Человек получит письмо, задаст пароль и сразу попадёт в «{cabinet.name}». В «Сотрудниках» выбранной
            организации он будет в группе «Мастер-кабинет»: журналы пищеблока ему не видны, права группы меняются в
            «Правах доступа». Считается в тарифе, как любой сотрудник.
          </div>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#3c4053]">
              <Building2 className="size-4 text-[#5566f6]" />
              Сотрудник какой организации
            </span>
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              disabled={busy || organizations.length === 0}
              className={INPUT}
              data-testid="cabinet-access-invite-org"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                  {cabinet.code && org.code === cabinet.code ? " — подключена к кабинету" : ""}
                </option>
              ))}
            </select>
            {organizations.length === 0 ? (
              <span className="mt-1.5 block text-[12px] text-[#a13a32]">
                Сначала заведите организацию — приглашённый должен быть в её «Сотрудниках».
              </span>
            ) : null}
          </label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ФИО, например Иванова Мария Петровна"
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
              Отправить приглашение
            </button>
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={cn(OUTLINE, "h-11 w-full sm:w-auto")}>
              Отмена
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
                placeholder="Имя, объект или должность"
                autoFocus
                className={cn(INPUT, "pl-10")}
                aria-label="Поиск сотрудника"
                data-testid="cabinet-access-search"
              />
            </label>
            <button
              type="button"
              onClick={() => setMode(null)}
              aria-label="Закрыть список"
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {groups.recommended.length + groups.other.length === 0 ? (
              <p className="px-2 py-4 text-center text-[13px] text-[#6f7282]">
                {query.trim() ? "Никого не нашли" : "У всех сотрудников объектов доступ уже есть"}
              </p>
            ) : (
              <>
                <CandidateGroup
                  title="Рекомендуем — руководство и технологи"
                  items={groups.recommended}
                  grantingId={grantingId}
                  onPick={grant}
                />
                <CandidateGroup title="Остальные сотрудники" items={groups.other} grantingId={grantingId} onPick={grant} />
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
            Пригласить по почте
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
            Дать доступ сотруднику
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={revoke}
        variant="warn"
        icon={UserMinus}
        title={`Убрать доступ к «${cabinet.name}»?`}
        description={removing ? `${removing.name} больше не сможет открыть этот кабинет.` : undefined}
        confirmLabel="Убрать доступ"
        bullets={
          removing?.kind === "member"
            ? [
                { label: "Кабинет пропадёт из его меню профиля." },
                {
                  label:
                    "Если он в группе «Мастер-кабинет» и других кабинетов у него нет — уйдёт в архив «Сотрудников», место в тарифе освободится. Остальные сотрудники работают как раньше.",
                  tone: "info",
                },
                { label: "На его устройствах нужно будет войти заново." },
              ]
            : [
                { label: "Его аккаунт уйдёт в архив: войти он больше не сможет." },
                { label: "Ссылка приглашения перестанет работать.", tone: "info" },
                { label: "Вернуть можно новым приглашением на тот же email." },
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
            <span className="hidden sm:inline">Дать доступ</span>
          </span>
        </button>
      ))}
    </div>
  );
}
