import Link from "next/link";
import { Building2, Mail, RefreshCw } from "lucide-react";
import { getBrandingSettings } from "@/lib/partners/branding-admin";
import { buildInviteTexts } from "@/lib/partners/invite-texts";
import { isOverviewFilter, loadPartnerOverview } from "@/lib/partners/overview";
import { loadPayoutForm, requirePartnerPage } from "@/lib/partners/page-context";
import { OnboardingWizard } from "@/components/partner/onboarding-wizard";
import { OverviewClients } from "@/components/partner/overview-clients";
import { PageGuide } from "@/components/ui/page-guide";
import { btnOutline, btnPrimary, formatDateTime } from "@/components/partner/ui";

export const dynamic = "force-dynamic";

export default async function PartnerOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { membership } = await requirePartnerPage();
  const { filter } = await searchParams;
  const partner = membership.partner;

  // Онбординг — до первого «Завершить»/«Пропустить». Данные для трёх шагов
  // грузим только когда он нужен.
  if (!partner.onboardingDoneAt) {
    const [branding, payout] = await Promise.all([
      getBrandingSettings(membership.partnerId),
      loadPayoutForm(membership.partnerId),
    ]);
    return (
      <OnboardingWizard
        branding={branding}
        inviteTexts={buildInviteTexts(partner.brandName, partner.slug, partner.code, partner.hideFromClients)}
        payout={payout}
        canEditPayout={membership.role === "owner"}
      />
    );
  }

  const overview = await loadPartnerOverview(membership.partnerId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Обзор</h1>
          <p className="mt-1 text-[14px] text-[#6f7282]">
            Все клиенты {partner.brandName} и их состояние на {formatDateTime(overview.generatedAt)}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/partner" className={btnOutline} title="Пересчитать">
            <RefreshCw className="size-4 text-[#5566f6]" />
            Обновить
          </Link>
          <Link href="/partner/invites" className={btnOutline}>
            <Mail className="size-4 text-[#5566f6]" />
            Пригласить клиента
          </Link>
          {/* Второй путь подключения: клиента, который ещё не в WeSetup,
              быстрее завести самому, чем ждать, пока он зарегистрируется. */}
          <Link href="/partner/clients/new" className={btnPrimary}>
            <Building2 className="size-4" />
            Создать организацию
          </Link>
        </div>
      </div>

      <PageGuide
        title="Как читать обзор"
        storageKey="partner-overview"
        bullets={[
          "«Активные» — у клиента есть записи в журналах каждый из последних 7 дней. Если клиент выпал из активных — ему стоит позвонить.",
          "«Просрочка сегодня» — число ежедневных журналов, в которых за сегодня ещё нет ни одной записи (по часовому поясу клиента).",
          "«Медкнижки» — сотрудники клиента, у которых обследование истекает в ближайшие 30 дней или уже просрочено.",
          "Нажмите на клиента — откроется карточка: заметки, начисления, реквизиты организации и кнопка «Открыть кабинет».",
          "Клиента, которого ещё нет в WeSetup, можно завести самому кнопкой «Создать организацию»: настроите за него журналы и сотрудников, а потом отправите приглашение владельцу.",
        ]}
      />

      <OverviewClients
        tiles={overview.tiles}
        clients={overview.clients}
        initialFilter={isOverviewFilter(filter) ? filter : "all"}
      />
    </div>
  );
}
