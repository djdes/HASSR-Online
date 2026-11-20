"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ACCOUNT_TRANSFER_COMMENT_MAX,
  keepTransferKeyAfter,
  parseTransferAmount,
  type AccountBalances,
  type TransferAmountCheck,
} from "@/lib/balance/account-transfer";
import { formatPoints } from "@/lib/balance/constants";

import { Section, StatusPill, inputClass, primaryButtonClass, secondaryButtonClass } from "./balance-ui";

/**
 * «Баланс по аккаунту» (серия B, Р10): организации аккаунта с балансами,
 * итог и перевод между ними. Только владельцу аккаунта с двумя
 * организациями и больше — решает сервер (страница не передаёт сводку).
 *
 * Ключ повтора создаётся один раз на отправку формы: повторное нажатие
 * после обрыва сети, 5xx или нечитаемого ответа уходит с тем же ключом и
 * второй раз не списывает (`keepTransferKeyAfter`). Организация, удаление
 * которой запрошено, в «Куда» не предлагается.
 */

type TransferResponse = {
  ok?: boolean;
  duplicate?: boolean;
  account?: AccountBalances;
  error?: string;
  code?: string;
  params?: { name?: unknown; balanceRub?: unknown };
};

type AmountError = Extract<TransferAmountCheck, { ok: false }>["code"];

const AMOUNT_ERROR_KEYS = {
  amount_required: "errors.amountRequired",
  amount_numeric: "errors.amountNumeric",
  amount_whole: "errors.amountWhole",
  amount_minimum: "errors.amountMinimum",
  amount_maximum: "errors.amountMaximum",
} as const satisfies Record<AmountError, string>;

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* небезопасный контекст — ниже запасной вариант */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Куда можно перевести из `fromId`: другая организация, удаление которой не запрошено. */
function destinations(data: AccountBalances, fromId: string) {
  return data.organizations.filter((org) => org.id !== fromId && !org.deletionRequested);
}

function otherThan(data: AccountBalances, id: string): string {
  return destinations(data, id)[0]?.id ?? "";
}

export function AccountBalanceSection({
  initial,
  onTransferred,
}: {
  initial: AccountBalances;
  /** Обновить остальной экран (баланс активной организации, детализацию). */
  onTransferred?: () => void | Promise<void>;
}) {
  const t = useTranslations("settingsManagement.balanceClient.account");
  const [data, setData] = useState(initial);
  const initialFrom = initial.organizations.some((org) => org.id === initial.activeOrganizationId)
    ? initial.activeOrganizationId
    : (initial.organizations[0]?.id ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [fromId, setFromId] = useState(initialFrom);
  const [toId, setToId] = useState(otherThan(initial, initialFrom));
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const from = data.organizations.find((org) => org.id === fromId) ?? null;
  const to = destinations(data, fromId).find((org) => org.id === toId) ?? null;
  const parsed = parseTransferAmount(amount);
  const amountError: string | null = !parsed.ok
    ? t(AMOUNT_ERROR_KEYS[parsed.code])
    : from && parsed.amountRub > from.balanceRub
      ? t("errors.overBalance", { name: from.name, amount: formatPoints(from.balanceRub) })
      : null;
  const formError = !from || !to || from.id === to.id ? t("errors.sameOrg") : amountError;

  function chooseFrom(id: string) {
    setFromId(id);
    if (id === toId) setToId(otherThan(data, id));
    keyRef.current = null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (formError) return;
    setConfirming(true);
  }

  async function transfer() {
    if (!parsed.ok || !from || !to) return;
    // Один ключ на отправку: сеть оборвалась — следующая попытка с ним же.
    keyRef.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const response = await fetch("/api/balance/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromId: from.id,
          toId: to.id,
          amountRub: parsed.amountRub,
          comment,
          idempotencyKey: keyRef.current,
        }),
      });
      const body = (await response.json().catch(() => null)) as TransferResponse | null;
      // Исход известен (2xx или отказ 4xx) — следующий перевод с новым ключом;
      // 5xx и нечитаемый ответ — перевод мог пройти, повтор идёт с этим же.
      if (!keepTransferKeyAfter({ status: response.status, body })) keyRef.current = null;
      setConfirming(false);
      if (!response.ok || !body?.ok) {
        setError(refusalText(response.status, body ?? {}));
        return;
      }
      if (body.account) setData(body.account);
      toast.success(
        body.duplicate
          ? t("duplicate")
          : t("success", { amount: formatPoints(parsed.amountRub), from: from.name, to: to.name }),
      );
      setAmount("");
      setComment("");
      setTouched(false);
      setFormOpen(false);
      await onTransferred?.();
    } catch {
      setConfirming(false);
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  function refusalText(status: number, body: TransferResponse): string {
    if (status === 429) return t("errors.tooMany");
    if (body.code === "insufficient") {
      const name = typeof body.params?.name === "string" ? body.params.name : (from?.name ?? "");
      const balance = typeof body.params?.balanceRub === "number" ? body.params.balanceRub : 0;
      return t("errors.overBalance", { name, amount: formatPoints(balance) });
    }
    if (body.code === "deleting") {
      return t("errors.toDeleting", { name: typeof body.params?.name === "string" ? body.params.name : (to?.name ?? "") });
    }
    if (body.code === "not_found") return t("errors.notFound");
    if (body.code === "not_owner") return t("errors.notOwner");
    if (body.code === "same_org" || body.code === "organizations") return t("errors.sameOrg");
    if (body.code && body.code in AMOUNT_ERROR_KEYS) return t(AMOUNT_ERROR_KEYS[body.code as AmountError]);
    return t("failed");
  }

  return (
    <div id="account-balance" className="scroll-mt-24" data-account-balance>
      <Section
        mini={false}
        icon={<Building2 className="size-5 text-[#3848c7]" />}
        title={t("title")}
        subtitle={t("subtitle")}
      >
        <ul className="divide-y divide-[#f2f3f8] rounded-2xl border border-[#ececf4]" data-account-balance-list>
          {data.organizations.map((org) => (
            <li key={org.id} className="flex items-center justify-between gap-3 px-4 py-3" data-account-org={org.id}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[14px] font-medium text-[#0b1024]">{org.name}</span>
                {org.active ? (
                  <StatusPill tone="info" mini={false}>
                    {t("current")}
                  </StatusPill>
                ) : null}
              </span>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums text-[#0b1024]">
                {formatPoints(org.balanceRub)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 bg-[#fafbff] px-4 py-3" data-account-total>
            <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">{t("total")}</span>
            <span className="shrink-0 text-[16px] font-semibold tabular-nums text-[#0b1024]">
              {formatPoints(data.totalRub)}
            </span>
          </li>
        </ul>

        {formOpen ? (
          <form className="mt-4 space-y-3" onSubmit={submit} data-account-transfer-form noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-[#0b1024]">{t("from")}</span>
                <select
                  className={inputClass(false)}
                  value={fromId}
                  onChange={(event) => chooseFrom(event.target.value)}
                  disabled={busy}
                >
                  {data.organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} · {formatPoints(org.balanceRub)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-[#0b1024]">{t("to")}</span>
                <select
                  className={inputClass(false)}
                  value={toId}
                  onChange={(event) => {
                    setToId(event.target.value);
                    keyRef.current = null;
                  }}
                  disabled={busy}
                >
                  {destinations(data, fromId).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-[#0b1024]">{t("amount")}</span>
                <input
                  className={inputClass(false)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t("amountPlaceholder")}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    keyRef.current = null;
                  }}
                  disabled={busy}
                  aria-invalid={touched && Boolean(amountError)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-[#0b1024]">{t("comment")}</span>
                <input
                  className={inputClass(false)}
                  maxLength={ACCOUNT_TRANSFER_COMMENT_MAX}
                  placeholder={t("commentPlaceholder")}
                  value={comment}
                  onChange={(event) => {
                    setComment(event.target.value);
                    keyRef.current = null;
                  }}
                  disabled={busy}
                />
              </label>
            </div>
            {(touched && formError) || error ? (
              <p className="text-[13px] text-[#a13a32]" role="alert">
                {error ?? formError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={primaryButtonClass(false)} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}
                {parsed.ok ? t("submit", { amount: formatPoints(parsed.amountRub) }) : t("transfer")}
              </button>
              <button
                type="button"
                className={secondaryButtonClass(false)}
                onClick={() => {
                  setFormOpen(false);
                  setError(null);
                  setTouched(false);
                }}
                disabled={busy}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={`${secondaryButtonClass(false)} mt-4`}
            onClick={() => setFormOpen(true)}
            data-account-transfer-open
          >
            <ArrowLeftRight className="size-4" />
            {t("transfer")}
          </button>
        )}
      </Section>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={transfer}
        title={parsed.ok ? t("confirmTitle", { amount: formatPoints(parsed.amountRub) }) : t("transfer")}
        description={t("confirmDescription", { from: from?.name ?? "", to: to?.name ?? "" })}
        confirmLabel={t("transfer")}
        variant="info"
      />
    </div>
  );
}
