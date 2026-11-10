"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/i18n/locales";
import { organizationDate, organizationKind } from "./organization-presentation";
import { Coins } from "lucide-react";
import { BalanceTopUpButton } from "./balance-top-up";


export type BalanceCardTransaction = {
  id: string;
  amount: number;
  kind: string;
  description: string;
  createdAt: string;
};

/**
 * Карточка баллов организации в ROOT: сколько на балансе, кто привёл, кого
 * привела эта организация, последние движения и «Пополнить баланс».
 *
 * Пополнение и списание — то же окно, что в списке клиентов и в шапке
 * карточки (`BalanceTopUpButton`): подтверждение с последствиями, потому что
 * это прямое изменение денежного обязательства платформы.
 */
export function BalanceCard({
  organizationId,
  organizationName,
  balanceRub,
  referredByName,
  referredCount,
  transactions,
}: {
  organizationId: string;
  organizationName: string;
  balanceRub: number;
  referredByName: string | null;
  referredCount: number;
  transactions: BalanceCardTransaction[];
}) {
  const t = useTranslations("rootOrganizationManagement");
  const locale = useLocale();
  const formatPoints = (amount: number) => t("format.points", { amount });
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[18px] font-semibold">
          <Coins className="size-5 text-[#5566f6]" />
          {t("balance.title")}</span>
        <span className="text-[26px] font-semibold tabular-nums text-[#0b1024]">
          {formatPoints(balanceRub)}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3 sm:gap-6">
        <div>
          <dt className="text-[#8a8ea4]">{t("balance.referredBy")}</dt>
          <dd className="mt-1 font-semibold text-black">
            {referredByName ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[#8a8ea4]">{t("balance.referredCount")}</dt>
          <dd className="mt-1 font-semibold tabular-nums text-black">
            {formatNumber(locale, referredCount)}
          </dd>
        </div>
        <div>
          <dt className="text-[#8a8ea4]">{t("balance.transactions")}</dt>
          <dd className="mt-1 font-semibold tabular-nums text-black">
            {formatNumber(locale, transactions.length)}
          </dd>
        </div>
      </dl>

      {transactions.length > 0 ? (
        <div className="mt-5 max-h-[280px] overflow-y-auto rounded-2xl border border-[#eef0f6]">
          <table className="w-full text-[13.5px]">
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id} className="border-b border-[#f2f3f8] last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-[#8a8ea4]">
                    {organizationDate(transaction.createdAt, locale, true)}
                  </td>
                  <td className="px-3 py-2 text-[#6f7282]">
                    {organizationKind(transaction.kind, t)}
                  </td>
                  <td className="px-3 py-2 text-[#0b1024]">
                    {transaction.description}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-medium ${
                      transaction.amount > 0 ? "text-[#116b2a]" : "text-[#a13a32]"
                    }`}
                  >
                    {transaction.amount > 0 ? "+" : "−"}
                    {formatPoints(Math.abs(transaction.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-5 text-[14px] text-[#9b9fb3]">
          {t("balance.empty")}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#eef0f6] pt-5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#0b1024]">{t("balance.adjustment")}</div>
          <p className="mt-0.5 text-[12.5px] text-[#6f7282]">{t("balance.adjustmentHint")}</p>
        </div>
        <BalanceTopUpButton organizationId={organizationId} organizationName={organizationName} balanceRub={balanceRub} size="regular" />
      </div>
    </div>
  );
}
