"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  KeyRound,
  Loader2,
  Rocket,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  badgeToneClass,
  formatAccountStatusBadge,
  formatRub,
  generateClientIdempotencyKey,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  formatRuDateTime,
  type GglAccountDto,
  type GglCampaignDto,
  SEO_BTN_OUTLINE_CLASS,
  SEO_BTN_PRIMARY_CLASS,
  SEO_CARD_CLASS,
  SEO_INPUT_CLASS,
  type SeoLinksViewerCapabilities,
  type SimilarwebSnapshotDto,
} from "./types";

export interface DemandAndAccountTabProps {
  account: GglAccountDto | null;
  campaigns: GglCampaignDto[];
  snapshots?: SimilarwebSnapshotDto[];
  viewer: SeoLinksViewerCapabilities;
  onRefreshOverview: () => Promise<void> | void;
}

export function DemandAndAccountTab({
  account,
  campaigns,
  viewer,
  onRefreshOverview,
}: DemandAndAccountTabProps) {
  return (
    <div className="space-y-6">
      <AccountConnectionCard
        key={`${account?.id ?? "none"}:${account?.lastSyncedAt ?? ""}:${account?.defaultCampaignId ?? ""}:${account?.allowSeoApproveWithinPlan ?? false}`}
        account={account}
        campaigns={campaigns}
        viewer={viewer}
        onRefreshOverview={onRefreshOverview}
      />

      {/* Pointer to the dedicated Similarweb Competitors top-level SEO tab */}
      <section className={SEO_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              <BarChart3 className="size-4 text-[#5566f6]" />
              Спрос Similarweb и сверка с конкурентами вынесены в отдельную вкладку
            </div>
            <p className="mt-1 text-[13.5px] text-[#3c4053]">
              Загрузка трафика через <code>api-anything</code>, распознавание скриншотов Similarweb, сводная сверка доменов (wesetup.ru vs haccp-online.ru, checkoffice.ru) и Gap-анализ поисковых кластеров находятся в разделе <strong>«Конкуренты (Similarweb)»</strong> верхнего меню SEO.
            </p>
          </div>

          <Link
            href="/root/seo/competitors"
            className={SEO_BTN_PRIMARY_CLASS}
          >
            <BarChart3 className="size-4" />
            Открыть «Конкуренты (Similarweb)»
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function AccountConnectionCard({
  account,
  campaigns,
  viewer,
  onRefreshOverview,
}: {
  account: GglAccountDto | null;
  campaigns: GglCampaignDto[];
  viewer: SeoLinksViewerCapabilities;
  onRefreshOverview: () => Promise<void> | void;
}) {
  const wesetupCampaigns = campaigns.filter((c) => c.isWesetup);
  const statusBadge = formatAccountStatusBadge(account?.status);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [defaultCampaignId, setDefaultCampaignId] = useState<string>(() => {
    if (account?.defaultCampaignId) return String(account.defaultCampaignId);
    const activeWs =
      wesetupCampaigns.find((c) => c.state === "active") ?? wesetupCampaigns[0];
    return activeWs ? String(activeWs.gglCampaignId) : "";
  });
  const [allowSeoApproveWithinPlan, setAllowSeoApproveWithinPlan] = useState(
    account?.allowSeoApproveWithinPlan ?? false,
  );
  const [savingAccount, setSavingAccount] = useState(false);
  const [ensuringCampaign, setEnsuringCampaign] = useState(false);

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!viewer.isSuperadmin) return;
    if (!account && (!email.trim() || !password)) {
      toast.error("Для первого подключения укажите email и пароль GoGetLinks");
      return;
    }

    setSavingAccount(true);
    try {
      const payload: Record<string, unknown> = {
        allowSeoApproveWithinPlan,
        defaultCampaignId: defaultCampaignId
          ? Number.parseInt(defaultCampaignId, 10)
          : null,
      };
      if (email.trim()) payload.email = email.trim();
      if (password) payload.password = password;

      const response = await fetch("/api/root/gogetlinks/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ?? "Не удалось сохранить подключение GoGetLinks",
        );
      }
      setEmail("");
      setPassword("");
      toast.success("Настройки кабинета GoGetLinks сохранены и проверены");
      await onRefreshOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleEnsureCampaign() {
    if (!viewer.isSuperadmin) return;
    setEnsuringCampaign(true);
    try {
      const response = await fetch("/api/root/gogetlinks/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "WeSetup электронные журналы ХАССП",
          idempotencyKey: generateClientIdempotencyKey("ensure-wesetup-camp"),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        campaign?: { name: string; gglCampaignId: number };
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          data?.error ??
            "Не удалось создать или привязать кампанию wesetup.ru в GoGetLinks",
        );
      }
      toast.success(
        data?.campaign
          ? `Кампания ${data.campaign.name} (#${data.campaign.gglCampaignId}) активна и привязана`
          : "Кампания wesetup.ru готова к работе",
      );
      await onRefreshOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка кампании");
    } finally {
      setEnsuringCampaign(false);
    }
  }

  return (
    <section className={SEO_CARD_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            <KeyRound className="size-4 text-[#5566f6]" />
            Подключение кабинета GoGetLinks (api-anything Tier 1)
          </div>
          <p className="mt-0.5 text-[13px] text-[#6f7282]">
            Учётные данные и сессионные куки шифруются AES-256-GCM на сервере. Все автоматические и ручные операции изолированы доменом wesetup.ru.
          </p>
        </div>

        <span
          className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-medium ${badgeToneClass(
            statusBadge.badgeTone,
          )}`}
        >
          {statusBadge.label}
        </span>
      </div>

      {/* Read-only status summary visible to both superadmin and seo */}
      <div className="mt-4 grid gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[11.5px] text-[#6f7282]">Аккаунт GoGetLinks</div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {account?.email ?? "Не настроен"}
          </div>
        </div>
        <div>
          <div className="text-[11.5px] text-[#6f7282]">Кошелёк кабинета</div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {formatRub(account?.availableRub ?? 0)}{" "}
            <span className="text-[12px] font-normal text-[#6f7282]">
              доступно из {formatRub(account?.balanceRub ?? 0)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[11.5px] text-[#6f7282]">
            Активные кампании wesetup.ru
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {wesetupCampaigns.length > 0
              ? wesetupCampaigns
                  .map((c) => `${c.name} (#${c.gglCampaignId})`)
                  .join(", ")
              : "Ещё не создана"}
          </div>
          {account?.defaultCampaignId &&
          wesetupCampaigns.some(
            (c) => c.gglCampaignId === account.defaultCampaignId,
          ) ? (
            <div className="mt-1 inline-flex items-center rounded-full border border-[#bce3c8] bg-[#e9f8ee] px-2 py-0.5 text-[11px] font-medium text-[#116b2a]">
              Выбрана перманентно (#{account.defaultCampaignId})
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[11.5px] text-[#6f7282]">
            Последняя синхронизация
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-[#0b1024]">
            {formatRuDateTime(account?.lastSyncedAt)}
          </div>
        </div>
      </div>

      {viewer.isSuperadmin ? (
        <form
          method="post"
          onSubmit={(e) => void handleSaveAccount(e)}
          className="mt-4 space-y-4 border-t border-[#ececf4] pt-4"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                {account
                  ? "Новый email GoGetLinks (оставьте пустым, чтобы не менять)"
                  : "Email аккаунта GoGetLinks"}
              </label>
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={account?.email ?? "seo@wesetup.ru"}
                className={SEO_INPUT_CLASS}
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                {account
                  ? "Новый пароль (оставьте пустым, чтобы не менять)"
                  : "Пароль GoGetLinks"}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className={SEO_INPUT_CLASS}
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#6f7282]">
                Основная кампания wesetup.ru
              </label>
              <select
                value={defaultCampaignId}
                onChange={(e) => setDefaultCampaignId(e.target.value)}
                className={SEO_INPUT_CLASS}
              >
                <option value="">Выбирать автоматически (wesetup.ru)</option>
                {wesetupCampaigns.map((c) => (
                  <option key={c.id} value={String(c.gglCampaignId)}>
                    {c.name} (#{c.gglCampaignId})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13px] text-[#0b1024]">
              <input
                type="checkbox"
                checked={allowSeoApproveWithinPlan}
                onChange={(e) =>
                  setAllowSeoApproveWithinPlan(e.target.checked)
                }
                className="size-4 rounded border-[#dcdfed] text-[#5566f6]"
              />
              <span>
                Разрешить специалистам с разделом{" "}
                <strong>«SEO и реклама»</strong> самостоятельно подтверждать подготовленные слоты в пределах утверждённого плана
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {account ? (
                <button
                  type="button"
                  disabled={ensuringCampaign}
                  onClick={() => void handleEnsureCampaign()}
                  className={SEO_BTN_OUTLINE_CLASS}
                >
                  {ensuringCampaign ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Rocket className="size-4 text-[#5566f6]" />
                  )}
                  {wesetupCampaigns.some((c) => c.state === "active")
                    ? "Закрепить кампанию wesetup.ru в GoGetLinks"
                    : "Создать кампанию wesetup.ru в GoGetLinks"}
                </button>
              ) : null}

              <button
                type="submit"
                disabled={savingAccount}
                className={SEO_BTN_PRIMARY_CLASS}
              >
                {savingAccount ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {savingAccount ? "Проверка входа…" : "Сохранить настройки"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="mt-3 text-[12.5px] text-[#6f7282]">
          Право подтверждения слотов внутри плана для роли SEO:{" "}
          <strong className="text-[#0b1024]">
            {account?.allowSeoApproveWithinPlan
              ? "включено владельцем"
              : "выключено (подтверждает администратор платформы)"}
          </strong>
          . Изменение логина, пароля и создание кампании доступны только владельцу (`superadmin`).
        </div>
      )}
    </section>
  );
}
