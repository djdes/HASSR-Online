"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Coins, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { showAccountCollect } from "@/lib/balance/account-pay";
import { keepTransferKeyAfter } from "@/lib/balance/account-transfer";
import { formatPoints } from "@/lib/balance/constants";
import type { BillingCycle, PaidTier } from "@/lib/tariff-plans";
import { cn } from "@/lib/utils";

/**
 * «Собрать с организаций аккаунта и оплатить» (серия E, Р10) — под кнопкой
 * оплаты тарифа. Видна владельцу аккаунта (решает сервер — `hint`), когда на
 * балансе активной организации не хватает на выбранную оплату, а по аккаунту
 * хватает. Подтверждение показывает точную сумму (с промокодом и скидкой
 * навсегда) и откуда сколько переведём; оплата — `POST
 * /api/settings/subscription/account-pay`.
 *
 * Ключ повтора — один на открытое подтверждение: обрыв сети, 5xx или
 * нечитаемый ответ — следующая попытка с ним же и второй раз не переведёт и
 * не спишет (`keepTransferKeyAfter`, как у перевода).
 */

export type AccountCollectHint = {
  /** Баланс активной организации. */
  activeBalanceRub: number;
  /** Сумма балансов организаций аккаунта (без демо, кабинетов и удаляемых). */
  accountTotalRub: number;
};

type Preview = {
  price: number;
  activeBalance: number;
  missing: number;
  accountTotal: number;
  activeName: string;
  sources: Array<{ orgId: string; name: string; amount: number }>;
  canPay: boolean;
};

type Refusal = {
  error?: string;
  code?: string;
  params?: { priceRub?: unknown; shortRub?: unknown; movedRub?: unknown; activeName?: unknown; sourceName?: unknown; name?: unknown };
};

type PayResponse = Refusal & {
  ok?: boolean;
  status?: "paid" | "already";
  priceRub?: number;
  transfers?: Array<{ amountRub: number }>;
};

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* небезопасный контекст — ниже запасной вариант */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function AccountCollectPay({
  target,
  payRub,
  hint,
  promoCode,
  dark,
}: {
  target: { tier: PaidTier; cycle: BillingCycle; points: number };
  /** Цена на кнопке оплаты (с акцией). */
  payRub: number;
  hint: AccountCollectHint;
  promoCode: string | null;
  /** Тёмная карточка («Стандарт») — светлый текст. */
  dark: boolean;
}) {
  const t = useTranslations("settingsUi.subscriptionPage.accountPay");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  // Открытое подтверждение не пропадает, даже если после частичного сбоя
  // (страница обновилась) кнопка уже не нужна: человек должен прочитать итог.
  const visible = showAccountCollect({ payRub, activeBalanceRub: hint.activeBalanceRub, accountTotalRub: hint.accountTotalRub });
  if (!visible && !open) return null;

  const selection = { plan: target.tier, cycle: target.cycle, points: target.points, promoCode };

  function refusalText(status: number, body: Refusal | null): string {
    if (status === 429) return t("errors.tooMany");
    const params = body?.params ?? {};
    const moved = num(params.movedRub);
    const name = str(params.activeName) || preview?.activeName || "";
    switch (body?.code) {
      case "not_owner":
        return t("errors.notOwner");
      case "account_short":
        return t("errors.accountShort", { amount: formatPoints(num(params.shortRub)) });
      case "price_changed":
        return t("errors.priceChanged", { amount: formatPoints(num(params.priceRub)) });
      case "deleting":
        return t("errors.deleting", { name: str(params.name) });
      case "transfer_failed":
        return moved > 0
          ? t("errors.transferFailed", { source: str(params.sourceName), moved: formatPoints(moved), name })
          : t("errors.transferFailedNothing", { source: str(params.sourceName) });
      case "charge_failed":
        return moved > 0 ? t("errors.chargeFailed", { moved: formatPoints(moved), name }) : t("errors.chargeFailedNothing");
      default:
        // Отказ расчёта тарифа (переход с конца срока, точки, промокод) — фраза сервера, как на странице заказа.
        return body?.error || t("errors.failed");
    }
  }

  async function loadPreview(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/subscription/account-pay?preview=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const body = (await response.json().catch(() => null)) as (Preview & Refusal) | null;
      if (!response.ok || !body || typeof body.price !== "number") {
        setPreview(null);
        setError(refusalText(response.status, body));
        return;
      }
      setPreview(body);
      if (!body.canPay) setError(t("errors.accountShort", { amount: formatPoints(Math.max(0, body.price - body.accountTotal)) }));
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  function openConfirm() {
    keyRef.current = newIdempotencyKey();
    setPreview(null);
    setError(null);
    setOpen(true);
    void loadPreview();
  }

  async function pay() {
    if (!preview?.canPay) return;
    keyRef.current ??= newIdempotencyKey();
    setError(null);
    try {
      const response = await fetch("/api/settings/subscription/account-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, idempotencyKey: keyRef.current, expectedPriceRub: preview.price }),
      });
      const body = (await response.json().catch(() => null)) as PayResponse | null;
      // Исход известен — следующая попытка с новым ключом; 5xx и обрыв — с этим же.
      if (!keepTransferKeyAfter({ status: response.status, body })) keyRef.current = null;
      if (!response.ok || !body?.ok) {
        setError(refusalText(response.status, body));
        if (body?.code === "price_changed") {
          await loadPreview();
        } else if (body?.code === "transfer_failed" || body?.code === "charge_failed") {
          // Часть денег уже переехала — балансы на странице должны это показать.
          router.refresh();
        }
        return;
      }
      const moved = (body.transfers ?? []).reduce((sum, row) => sum + num(row.amountRub), 0);
      toast.success(
        body.status === "already"
          ? t("already")
          : moved > 0
            ? t("successCollected", { moved: formatPoints(moved), amount: formatPoints(num(body.priceRub)) })
            : t("success", { amount: formatPoints(num(body.priceRub)) }),
      );
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("errors.network"));
    }
  }

  const bullets = preview?.canPay
    ? [
        ...preview.sources.map((row) => ({ label: t("sourceLine", { name: row.name, amount: formatPoints(row.amount) }), tone: "info" as const })),
        { label: t("chargeLine", { name: preview.activeName, amount: formatPoints(preview.price) }), tone: "default" as const },
      ]
    : undefined;

  return (
    <>
      {visible ? (
        <button
          type="button"
          onClick={openConfirm}
          data-testid={`tariff-account-collect-${target.tier}`}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 text-center text-[13px] font-medium underline underline-offset-2 disabled:opacity-60",
            dark ? "text-white/80" : "text-[#3848c7]",
          )}
        >
          <Coins className="size-3.5 shrink-0" />
          {t("button")}
        </button>
      ) : null}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={pay}
        title={preview ? t("confirmTitle", { amount: formatPoints(preview.price) }) : t("button")}
        description={
          preview?.canPay
            ? preview.missing > 0
              ? t("confirmDescription", {
                  name: preview.activeName,
                  balance: formatPoints(preview.activeBalance),
                  missing: formatPoints(preview.missing),
                })
              : t("confirmEnough", { name: preview.activeName })
            : undefined
        }
        bullets={bullets}
        confirmLabel={preview?.canPay && preview.missing > 0 ? t("confirmCollect") : t("confirm")}
        confirmDisabled={loading || !preview?.canPay}
        variant="info"
        icon={Coins}
      >
        {loading ? (
          <p className="flex items-center gap-2 text-[13px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </p>
        ) : error ? (
          <p className="text-[13px] leading-[1.5] text-[#a13a32]" role="alert">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
