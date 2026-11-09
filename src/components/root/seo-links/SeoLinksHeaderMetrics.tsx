"use client";

import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Wallet,
} from "lucide-react";
import {
  badgeToneClass,
  formatAccountStatusBadge,
  formatRub,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  formatRuDateTime,
  type GglAccountDto,
  type GglOverviewMetrics,
  SEO_BTN_PRIMARY_CLASS,
} from "./types";

export interface SeoLinksHeaderMetricsProps {
  account: GglAccountDto | null;
  metrics: GglOverviewMetrics | null;
  syncing: boolean;
  onSyncNow: () => void;
  includeOtherProjects: boolean;
  onToggleIncludeOtherProjects: (next: boolean) => void;
  onOpenTab: (tab: "applications" | "planner" | "orders" | "chats" | "demand") => void;
}

export function SeoLinksHeaderMetrics({
  account,
  metrics,
  syncing,
  onSyncNow,
  includeOtherProjects,
  onToggleIncludeOtherProjects,
  onOpenTab,
}: SeoLinksHeaderMetricsProps) {
  const availableRub = account?.availableRub ?? 0;
  const balanceRub = account?.balanceRub ?? 0;
  const blockedRub = account?.blockedRub ?? 0;
  const next7DaysPendingRub = metrics?.next7DaysPendingRub ?? 0;
  const monthSpentRub = metrics?.monthSpentRub ?? 0;
  const monthlyPlanBudgetRub = metrics?.monthlyPlanBudgetRub ?? 0;

  const counts = metrics?.counts ?? {
    paidOrders: 0,
    inProgressOrders: 0,
    onCheckOrders: 0,
    needsReplacementOrders: 0,
    unreadThreads: 0,
    pendingApprovalSlots: 0,
    otherProjectsCampaignsCount: 0,
    webmasterApplications: 0,
  };

  const hasEnoughFor7Days = availableRub >= next7DaysPendingRub;
  const accountBadge = formatAccountStatusBadge(account?.status);
  const spendProgressPct =
    monthlyPlanBudgetRub > 0
      ? Math.min(100, Math.round((monthSpentRub / monthlyPlanBudgetRub) * 100))
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[#ececf4] bg-white px-5 py-3.5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-[#6f7282]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${badgeToneClass(
              accountBadge.badgeTone,
            )}`}
          >
            {accountBadge.label}
          </span>
          {account ? (
            <span>
              Аккаунт <strong className="font-medium text-[#0b1024]">{account.email}</strong> ·
              синхронизация: {formatRuDateTime(account.lastSyncedAt)}
            </span>
          ) : (
            <span>
              Кабинет GoGetLinks ещё не подключён — настройте доступ во вкладке «Спрос Similarweb и подключение».
            </span>
          )}
          {account?.lastError ? (
            <span className="inline-flex items-center gap-1 text-[#a13a32]">
              <AlertTriangle className="size-3.5 shrink-0" />
              {account.lastError}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3.5 py-2 text-[12.5px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40">
            <input
              type="checkbox"
              checked={includeOtherProjects}
              onChange={(e) => onToggleIncludeOtherProjects(e.target.checked)}
              className="size-4 rounded border-[#dcdfed] text-[#5566f6] focus:ring-[#5566f6]/20"
            />
            <Archive className="size-3.5 text-[#6f7282]" />
            <span>
              Показать архив других проектов аккаунта (только чтение)
              {counts.otherProjectsCampaignsCount > 0
                ? ` · ${counts.otherProjectsCampaignsCount}`
                : ""}
            </span>
          </label>

          <button
            type="button"
            onClick={onSyncNow}
            disabled={syncing || !account}
            className={SEO_BTN_PRIMARY_CLASS}
          >
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Синхронизация…" : "Синхронизировать сейчас"}
          </button>
        </div>
      </div>

      {includeOtherProjects ? (
        <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-4 py-2.5 text-[13px] text-[#92400e]">
          Включён просмотр архивных кампаний других доменов владельца. Все операции планировщика, оплаты и ответов вебмастерам для сторонних доменов заблокированы (режим «только чтение»).
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* 1. Available balance & 7-day plan coverage */}
        <div className="rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            <span>Доступный баланс</span>
            <Wallet className="size-4 text-[#5566f6]" />
          </div>
          <div className="mt-2 text-[24px] font-semibold tracking-tight text-[#0b1024]">
            {formatRub(availableRub)}
          </div>
          <div className="mt-1 text-[12px] text-[#6f7282]">
            Всего: {formatRub(balanceRub)} · заморожено: {formatRub(blockedRub)}
          </div>
          <div className="mt-2.5">
            {next7DaysPendingRub > 0 ? (
              hasEnoughFor7Days ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[11.5px] font-medium text-[#116b2a]">
                  <CheckCircle2 className="size-3.5" />
                  Покрывает слоты 7 дн. ({formatRub(next7DaysPendingRub)})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11.5px] font-medium text-[#a13a32]">
                  <AlertTriangle className="size-3.5" />
                  Не хватает на 7 дн. (нужно {formatRub(next7DaysPendingRub)})
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f8] px-2.5 py-0.5 text-[11.5px] font-medium text-[#6f7282]">
                На 7 дней слотов к оплате: 0 ₽
              </span>
            )}
          </div>
        </div>

        {/* 2. Month spend vs plan */}
        <div className="rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            Расход за месяц / План
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[24px] font-semibold tracking-tight text-[#0b1024]">
              {formatRub(monthSpentRub)}
            </span>
            <span className="text-[13px] text-[#6f7282]">
              из {formatRub(monthlyPlanBudgetRub)}
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#eef1ff]">
            <div
              className="h-full rounded-full bg-[#5566f6] transition-all"
              style={{ width: `${spendProgressPct}%` }}
            />
          </div>
          <div className="mt-2 text-[12px] text-[#6f7282]">
            Ждут подтверждения по плану:{" "}
            <button
              type="button"
              onClick={() => onOpenTab("planner")}
              className="font-medium text-[#3848c7] underline-offset-2 hover:underline"
            >
              {counts.pendingApprovalSlots} сл.
            </button>
          </div>
        </div>

        {/* 3. Active / In progress / On check */}
        <button
          type="button"
          onClick={() => onOpenTab("orders")}
          className="rounded-3xl border border-[#ececf4] bg-white p-4 text-left shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-colors hover:border-[#5566f6]/40"
        >
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            Размещения wesetup.ru
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <div>
              <div className="text-[24px] font-semibold tracking-tight text-[#116b2a]">
                {counts.paidOrders}
              </div>
              <div className="text-[11.5px] text-[#6f7282]">оплачено</div>
            </div>
            <div className="h-7 w-px bg-[#ececf4]" />
            <div>
              <div className="text-[24px] font-semibold tracking-tight text-[#3848c7]">
                {counts.inProgressOrders}
              </div>
              <div className="text-[11.5px] text-[#6f7282]">в работе</div>
            </div>
            <div className="h-7 w-px bg-[#ececf4]" />
            <div>
              <div className="text-[24px] font-semibold tracking-tight text-[#92400e]">
                {counts.onCheckOrders}
              </div>
              <div className="text-[11.5px] text-[#6f7282]">на проверке</div>
            </div>
          </div>
          {counts.needsReplacementOrders > 0 ? (
            <div className="mt-2 text-[12px] font-medium text-[#a13a32]">
              Требуют замены: {counts.needsReplacementOrders}
            </div>
          ) : (
            <div className="mt-2 text-[12px] text-[#6f7282]">
              Замен по wesetup.ru не требуется
            </div>
          )}
        </button>

        {/* 4. Webmaster applications & unread messages */}
        <div className="rounded-3xl border border-[#ececf4] bg-white p-4 text-left shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            <span>Вебмастера и сообщения</span>
            <MessageSquare className="size-4 text-[#5566f6]" />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <button
              type="button"
              onClick={() => onOpenTab("applications")}
              className="text-left transition-opacity hover:opacity-80"
            >
              <div className="text-[24px] font-semibold tracking-tight text-[#3848c7]">
                {(counts.webmasterApplications ?? 0).toLocaleString("ru-RU")}
              </div>
              <div className="text-[11.5px] text-[#6f7282]">заявок пришло</div>
            </button>
            <div className="h-7 w-px bg-[#ececf4]" />
            <button
              type="button"
              onClick={() => onOpenTab("chats")}
              className="text-left transition-opacity hover:opacity-80"
            >
              <div className="text-[24px] font-semibold tracking-tight text-[#0b1024]">
                {counts.unreadThreads}
              </div>
              <div className="text-[11.5px] text-[#6f7282]">сообщений</div>
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] font-medium text-[#3848c7]">
            <button
              type="button"
              onClick={() => onOpenTab("applications")}
              className="hover:underline"
            >
              Заявки →
            </button>
            <span className="text-[#dcdfed]">·</span>
            <button
              type="button"
              onClick={() => onOpenTab("chats")}
              className="hover:underline"
            >
              Мессенджер →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
