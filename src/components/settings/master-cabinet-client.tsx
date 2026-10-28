"use client";

import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  Library,
  Link2Off,
  Loader2,
  Mail,
  PenLine,
  Plus,
  RefreshCw,
  Store,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { CreateMasterCabinetDialog } from "@/components/master/create-master-cabinet-dialog";
import { renameMasterCabinetDialog } from "@/components/master/rename-master-cabinet";
import {
  CabinetAccessBlock,
  SETTINGS_ACCESS_ENDPOINT,
  type AccessData,
} from "@/components/settings/master-cabinet-access-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";
import { isBillingLimitError, useBillingError } from "@/lib/billing-limit-toast";
import type { MasterCabinetUser } from "@/lib/master-cabinet";
import type { OrgCabinetObject, OrgMasterCabinet, OrgMasterCabinetsView } from "@/lib/org-master-cabinets";
import { cn } from "@/lib/utils";

const ENDPOINT = "/api/settings/master-cabinet";
const OBJECTS_ENDPOINT = "/api/settings/master-cabinet/objects";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CARD =
  "min-w-0 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
const EYEBROW = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SOFT =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#eef1ff] px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#e2e7ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";

type ApiJson = {
  error?: string;
  view?: OrgMasterCabinetsView;
  name?: string;
  created?: boolean;
  inviteUrl?: string;
  emailSent?: boolean;
  user?: { email: string };
};

type InviteResult = { email: string; inviteUrl: string; emailSent: boolean };

async function callApi<T = ApiJson>(url: string, method: "POST" | "DELETE" | "GET", body?: unknown): Promise<{ ok: boolean; json: T | null }> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as T | null;
  return { ok: Boolean(response?.ok), json };
}

function copyText(value: string, okMessage: string, errorMessage: string) {
  void navigator.clipboard?.writeText(value).then(
    () => toast.success(okMessage),
    () => toast.error(errorMessage)
  );
}

function initialOf(person: { name: string; email: string }): string {
  return (person.name || person.email).trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * «Моя компания → Мастер-кабинет» (скан 99 от 2026-10-28): какие
 * мастер-кабинеты есть, какие точки организации к ним подключены, кто в них
 * оператор. Точка подключается кнопкой «Добавить точку» (код журнала точки
 * подставляет сервер), оператор — приглашением по почте. Владелец аккаунта
 * создаёт новые кабинеты и управляет их людьми (тот же блок, что в «Правах
 * доступа»).
 */
export function MasterCabinetClient({
  initialView,
  initialAccess,
}: {
  initialView: OrgMasterCabinetsView;
  /** Люди кабинетов аккаунта — только владельцу аккаунта. */
  initialAccess: AccessData | null;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const tPage = useTranslations("settingsUi.masterCabinetPage");
  const [view, setView] = useState(initialView);
  const [access, setAccess] = useState(initialAccess);
  const [createOpen, setCreateOpen] = useState(false);
  // Ссылка первого приглашения: пустое состояние после создания кабинета уходит, а ссылка нужна.
  const [firstInvite, setFirstInvite] = useState<InviteResult | null>(null);

  async function reload() {
    const [cabinets, people] = await Promise.all([
      callApi<OrgMasterCabinetsView>(ENDPOINT, "GET"),
      view.viewerIsOwner ? callApi<AccessData>(SETTINGS_ACCESS_ENDPOINT, "GET") : Promise.resolve(null),
    ]);
    if (cabinets.ok && cabinets.json) setView(cabinets.json);
    if (people?.ok && people.json) setAccess(people.json);
  }

  const canCreate = view.viewerIsOwner && !view.isDemo;

  return (
    <div className="space-y-5">
      <PageHeader
        title={tPage("title")}
        description={tPage("description")}
        actions={
          canCreate && view.cabinets.length > 0 ? (
            <button type="button" onClick={() => setCreateOpen(true)} className={SOFT} data-testid="master-cabinet-create">
              <Plus className="size-4" />
              {t("create")}
            </button>
          ) : null
        }
      />

      <PageGuide
        storageKey="settings-master-cabinets-v2"
        title={t("guide.title")}
        bullets={(["cabinet", "points", "operator"] as const).map((key) => ({
          title: t(`guide.${key}Title`),
          body: t(`guide.${key}Body`),
        }))}
        qa={(["code", "own", "sees", "move"] as const).map((key) => ({
          q: t(`guide.${key}Q`),
          a: t(`guide.${key}A`),
        }))}
      />

      {firstInvite ? <InviteResultBox result={firstInvite} /> : null}

      {view.cabinets.length === 0 ? (
        <NoCabinets view={view} onCreate={() => setCreateOpen(true)} onChange={setView} onInvite={setFirstInvite} />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {view.cabinets.map((cabinet) => (
            <CabinetCard
              key={cabinet.id}
              cabinet={cabinet}
              view={view}
              access={access}
              onView={setView}
              onAccess={setAccess}
            />
          ))}
        </div>
      )}

      {createOpen ? (
        <CreateMasterCabinetDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** Один кабинет: название, точки организации в нём и операторы. */
function CabinetCard({
  cabinet,
  view,
  access,
  onView,
  onAccess,
}: {
  cabinet: OrgMasterCabinet;
  view: OrgMasterCabinetsView;
  access: AccessData | null;
  onView: (next: OrgMasterCabinetsView) => void;
  onAccess: (next: AccessData) => void;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const tRename = useTranslations("masterUi.renameMasterCabinet");
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState<OrgCabinetObject | null>(null);

  const accessCabinet = view.viewerIsOwner && cabinet.ownAccount ? access?.cabinets.find((item) => item.id === cabinet.id) : undefined;
  // Что можно подключить сюда: свободные точки; точки других кабинетов — неактивны, с подписью.
  const available = view.connectable.filter((item) => item.cabinetId !== cabinet.id);
  const hasFree = available.some((item) => !item.cabinetId);

  async function rename() {
    const result = await renameMasterCabinetDialog({ currentName: cabinet.name, endpoint: ENDPOINT, t: tRename, cabinetId: cabinet.id });
    const next = result?.body.view as OrgMasterCabinetsView | undefined;
    if (next) onView(next);
  }

  async function openCabinet() {
    setOpening(true);
    try {
      const response = await fetch("/api/me/active-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: cabinet.id }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? t("openFailed"));
      window.location.assign("/master");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("openFailed"));
      setOpening(false);
    }
  }

  async function connect(buildingId: string | null, name: string) {
    setBusy(true);
    const { ok, json } = await callApi(OBJECTS_ENDPOINT, "POST", { cabinetId: cabinet.id, buildingId });
    setBusy(false);
    if (!ok || !json?.view) {
      toast.error(json?.error ?? t("apiFallbackError"));
      return;
    }
    onView(json.view);
    toast.success(t("points.connected", { name, cabinet: cabinet.name }), { description: t("points.connectedHint") });
  }

  async function disconnect() {
    if (!disconnecting) return;
    const target = disconnecting;
    const { ok, json } = await callApi(OBJECTS_ENDPOINT, "DELETE", { cabinetId: cabinet.id, buildingId: target.buildingId });
    if (!ok || !json?.view) {
      toast.error(json?.error ?? t("apiFallbackError"));
      return;
    }
    onView(json.view);
    setDisconnecting(null);
    toast.success(t("points.disconnected", { name: target.name, cabinet: cabinet.name }));
  }

  return (
    <section className={CARD} data-testid="master-cabinet-card" data-cabinet-id={cabinet.id}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Library className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <h2 className="min-w-0 break-words text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]" data-testid="master-cabinet-name">
              {cabinet.name}
            </h2>
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
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[#6f7282]">
            <span>{t("cabinet.objects", { count: cabinet.objectsCount })}</span>
            {cabinet.ownAccount ? null : (
              <span className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] font-medium text-[#3848c7]">{t("cabinet.foreign")}</span>
            )}
          </div>
        </div>
        {cabinet.viewerCanOpen ? (
          <button type="button" onClick={() => void openCabinet()} disabled={opening} className={OUTLINE} data-testid="master-open">
            {opening ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4 text-[#5566f6]" />}
            {t("cabinet.open")}
          </button>
        ) : null}
      </div>

      {/* Точки организации в кабинете */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className={EYEBROW}>{view.byPoints ? t("points.title") : t("points.titleOrganization")}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={SOFT}
                disabled={view.isDemo || busy || available.length === 0}
                title={available.length === 0 ? t("points.allHere") : t("points.addHint", { cabinet: cabinet.name })}
                data-testid="master-add-point"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {view.byPoints ? t("points.add") : t("points.addOrganization")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px] max-w-[calc(100vw-32px)]">
              <DropdownMenuLabel>{t("points.pick")}</DropdownMenuLabel>
              {available.map((item) => (
                <DropdownMenuItem
                  key={item.buildingId ?? "org"}
                  disabled={Boolean(item.cabinetId)}
                  onSelect={() => void connect(item.buildingId, item.name)}
                  className="items-start"
                  data-point-option={item.buildingId ?? "org"}
                >
                  {item.buildingId ? (
                    <Store className="mt-0.5 size-4 text-[#9b9fb3]" />
                  ) : (
                    <Building2 className="mt-0.5 size-4 text-[#9b9fb3]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-[12px] font-normal text-[#9b9fb3]">
                      {item.cabinetName ? t("points.inOther", { cabinet: item.cabinetName }) : item.address ?? t("points.free")}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
              {hasFree ? null : (
                <p className="px-3 pb-2 pt-1 text-[12.5px] leading-[1.45] text-[#6f7282]">{t("points.moveHint")}</p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {cabinet.objects.length > 0 ? (
          <ul className="mt-3 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]" data-testid="master-cabinet-points">
            {cabinet.objects.map((object) => (
              <li key={object.objectId} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="master-point-row">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]">
                  {object.buildingId ? <Store className="size-4" /> : <Building2 className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-[#0b1024]">{object.name}</span>
                  {object.address || (object.whole && object.buildingId) ? (
                    <span className="block truncate text-[12.5px] text-[#6f7282]">
                      {[object.address, object.whole && object.buildingId ? t("points.withOrganization") : null].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
                {object.canDisconnect ? (
                  <button
                    type="button"
                    onClick={() => setDisconnecting(object)}
                    disabled={view.isDemo}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:opacity-50"
                    data-testid="master-disconnect"
                  >
                    <Link2Off className="size-3.5" />
                    {t("points.disconnect")}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]" title={t("points.rootHint")}>
                    {t("points.root")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]">
            {t("points.none", { organization: view.organizationName })}
          </p>
        )}
      </div>

      {/* Операторы кабинета */}
      <div className="mt-6">
        <div className={EYEBROW}>{t("operators.title")}</div>
        <div className="mt-3">
          {accessCabinet && access ? (
            <CabinetAccessBlock
              endpoint={SETTINGS_ACCESS_ENDPOINT}
              cabinet={accessCabinet}
              candidates={access.candidates}
              onChange={onAccess}
              billingToast
              hideHeader
            />
          ) : (
            <OperatorsList cabinet={cabinet} view={view} onView={onView} />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        onConfirm={disconnect}
        variant="warn"
        icon={Link2Off}
        title={t("disconnect.title", { name: disconnecting?.name ?? "" })}
        description={t("disconnect.description", { cabinet: cabinet.name })}
        confirmLabel={t("disconnect.confirm")}
        bullets={[
          { label: t("disconnect.keeps") },
          ...(disconnecting?.whole && disconnecting.buildingId ? [{ label: t("disconnect.whole"), tone: "info" as const }] : []),
          { label: t("disconnect.again"), tone: "info" as const },
        ]}
      />
    </section>
  );
}

/**
 * Операторы для руководителя, который не владелец аккаунта (или кабинет
 * чужого аккаунта): список и приглашение по почте в кабинет, к которому
 * подключена организация.
 */
function OperatorsList({
  cabinet,
  view,
  onView,
}: {
  cabinet: OrgMasterCabinet;
  view: OrgMasterCabinetsView;
  onView: (next: OrgMasterCabinetsView) => void;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const canInvite = cabinet.objects.length > 0 && !view.isDemo;
  const [formOpen, setFormOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);
  const invite = useInvite(cabinet.id, onView, setLastInvite);

  return (
    <div className="space-y-3">
      {cabinet.operators.length > 0 ? (
        <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
          {cabinet.operators.map((user) => (
            <OperatorRow
              key={user.id}
              user={user}
              resending={resendingId === user.id}
              onResend={
                canInvite && user.invited
                  ? async () => {
                      setResendingId(user.id);
                      await invite({ name: user.name, email: user.email });
                      setResendingId(null);
                    }
                  : null
              }
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
          {t("operators.none")}
        </p>
      )}

      {lastInvite ? <InviteResultBox result={lastInvite} /> : null}

      {canInvite ? (
        formOpen ? (
          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
            <InviteForm
              submitLabel={t("form.sendInvite")}
              onCancel={() => setFormOpen(false)}
              onSubmit={async (person) => {
                const ok = await invite(person);
                if (ok) setFormOpen(false);
                return ok;
              }}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setFormOpen(true)} className={OUTLINE} data-testid="master-invite-open">
            <UserPlus className="size-4 text-[#5566f6]" />
            {t("operators.invite")}
          </button>
        )
      ) : (
        <p className="text-[12.5px] leading-[1.5] text-[#6f7282]">
          {cabinet.objects.length === 0 ? t("operators.connectFirst") : t("operators.ownerOnly")}
        </p>
      )}
    </div>
  );
}

function OperatorRow({
  user,
  resending,
  onResend,
}: {
  user: MasterCabinetUser;
  resending: boolean;
  onResend: (() => Promise<void>) | null;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
        {initialOf(user)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-[#0b1024]">{user.name}</span>
        <span className="block truncate text-[12.5px] text-[#6f7282]">{user.email}</span>
      </span>
      {user.invited ? (
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] font-medium text-[#9a4a06]">{t("operators.invited")}</span>
          {onResend ? (
            <button
              type="button"
              onClick={() => void onResend()}
              disabled={resending}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:opacity-50"
              title={t("operators.resendTitle")}
            >
              {resending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {t("operators.resend")}
            </button>
          ) : null}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
          <Check className="size-3.5" />
          {t("operators.joined")}
        </span>
      )}
    </li>
  );
}

/** POST приглашения: `cabinetId` — в кабинет, без него — создать кабинет из организации. */
function useInvite(
  cabinetId: string | null,
  onView: (next: OrgMasterCabinetsView) => void,
  onResult: (result: InviteResult) => void
) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const { toastApiError } = useBillingError();
  return async (person: { name: string; email: string }): Promise<boolean> => {
    const { ok, json } = await callApi(ENDPOINT, "POST", { ...person, ...(cabinetId ? { cabinetId } : {}) });
    if (!ok || !json?.inviteUrl) {
      // Места тарифа заняты — общий тост: следующий тариф и кнопка.
      if (isBillingLimitError(json)) toastApiError(json, t("apiFallbackError"));
      else toast.error(json?.error ?? t("apiFallbackError"));
      return false;
    }
    if (json.view) onView(json.view);
    const email = json.user?.email ?? person.email;
    onResult({ email, inviteUrl: json.inviteUrl, emailSent: json.emailSent !== false });
    toast.success(json.created ? t("cabinetCreated") : t("inviteReady", { email }));
    return true;
  };
}

function InviteForm({
  submitLabel,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  onSubmit: (person: { name: string; email: string }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length >= 2 && EMAIL_RE.test(email.trim());

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        const ok = await onSubmit({ name: name.trim(), email: email.trim() });
        setBusy(false);
        if (ok) {
          setName("");
          setEmail("");
        }
      }}
    >
      <p className="text-[13px] leading-[1.5] text-[#3c4053]">{t("form.who")}</p>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("form.nameLabel")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("form.namePlaceholder")}
          autoComplete="name"
          disabled={busy}
          className={INPUT}
          data-testid="master-invite-name"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Email</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="operator@company.ru"
          type="email"
          inputMode="email"
          autoComplete="email"
          disabled={busy}
          className={INPUT}
          data-testid="master-invite-email"
        />
        <span className="mt-1.5 block text-[12px] leading-[1.5] text-[#6f7282]">{t("form.emailHint")}</span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={!valid || busy} className={cn(PRIMARY, "w-full sm:w-auto")} data-testid="master-invite-submit">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={cn(OUTLINE, "h-11 w-full sm:w-auto")}>
            {t("form.cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function InviteResultBox({ result }: { result: InviteResult }) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border p-4",
        result.emailSent ? "border-[#c9f0da] bg-[#ecfdf5]" : "border-[#ffe2b8] bg-[#fff8eb]"
      )}
      data-testid="master-invite-result"
    >
      <div className={cn("flex items-start gap-2 text-[14px] font-medium", result.emailSent ? "text-[#116b2a]" : "text-[#9a4a06]")}>
        <Mail className="mt-0.5 size-4 shrink-0" />
        <span>{result.emailSent ? t("result.sent", { email: result.email }) : t("result.notSent", { email: result.email })}</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={result.inviteUrl}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={t("result.linkLabel")}
          className="h-10 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-3 font-mono text-[12.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          data-testid="master-invite-url"
        />
        <button type="button" onClick={() => copyText(result.inviteUrl, t("result.linkCopied"), t("copyFailed"))} className={OUTLINE}>
          <Copy className="size-4 text-[#5566f6]" />
          {t("copy")}
        </button>
      </div>
      <p className="text-[12px] leading-[1.5] text-[#6f7282]">{t("result.validity")}</p>
    </div>
  );
}

/**
 * Кабинетов нет. Владельцу аккаунта — «Новый мастер-кабинет» (название и
 * объекты); остальным — создать кабинет из организации и пригласить первого
 * оператора, как раньше.
 */
function NoCabinets({
  view,
  onCreate,
  onChange,
  onInvite,
}: {
  view: OrgMasterCabinetsView;
  onCreate: () => void;
  onChange: (next: OrgMasterCabinetsView) => void;
  onInvite: (result: InviteResult) => void;
}) {
  const t = useTranslations("settingsUi.masterCabinetClient");
  const [pending, setPending] = useState<{ name: string; email: string } | null>(null);
  const invite = useInvite(null, onChange, onInvite);

  return (
    <section className={CARD} data-testid="master-cabinet-empty">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Library className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("empty.title")}</h2>
          <p className="mt-1 max-w-[620px] text-[13.5px] leading-[1.55] text-[#6f7282]">
            {view.viewerIsOwner ? t("empty.owner") : t("empty.other", { organization: view.organizationName })}
          </p>
        </div>
      </div>
      {view.isDemo ? (
        <p className="mt-4 rounded-2xl bg-[#fff8eb] px-4 py-3 text-[13px] text-[#9a4a06]">{t("empty.demo")}</p>
      ) : view.viewerIsOwner ? (
        <button type="button" onClick={onCreate} className={cn(PRIMARY, "mt-5")} data-testid="master-cabinet-create-empty">
          <Plus className="size-4" />
          {t("create")}
        </button>
      ) : (
        <div className="mt-5 max-w-[520px]">
          {/* Сначала подтверждение: что появится и кто что увидит. */}
          <InviteForm
            submitLabel={t("form.createCabinet")}
            onSubmit={async (person) => {
              setPending(person);
              return false;
            }}
          />
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          const ok = await invite(pending);
          if (ok) setPending(null);
        }}
        title={t("confirm.title")}
        description={t("confirm.description", { name: pending?.name ?? "", email: pending?.email ?? "" })}
        icon={Library}
        confirmLabel={t("confirm.confirmLabel")}
        bullets={[
          { label: t("confirm.bullet1") },
          { label: t("confirm.bullet2"), tone: "info" },
          { label: t("confirm.bullet3", { organization: view.organizationName }), tone: "info" },
          { label: t("confirm.bullet4") },
        ]}
      />
    </section>
  );
}
