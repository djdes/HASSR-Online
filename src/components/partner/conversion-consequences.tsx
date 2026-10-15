import { AlertTriangle, ArrowRight, Coins, CreditCard, KeyRound, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Blocker, ConsequenceGroup, ConsequenceLine, Consequences } from "@/lib/partners/org-conversion-core";

/**
 * РџРѕСЃР»РµРґСЃС‚РІРёСЏ РїРµСЂРµРІРѕРґР° РѕСЂРіР°РЅРёР·Р°С†РёРё РІ РїР°СЂС‚РЅС‘СЂСЃРєРёР№ РєР°Р±РёРЅРµС‚ (Рё РІРѕР·РІСЂР°С‚Р°) вЂ”
 * РіСЂСѓРїРїР°РјРё: РѕРїР»Р°С‚Р°, РјРµСЃС‚Р°, РІРѕР·РЅР°РіСЂР°Р¶РґРµРЅРёРµ, РґРѕСЃС‚СѓРї, С‡С‚Рѕ РґР°Р»СЊС€Рµ. РўРµРєСЃС‚С‹
 * СЃРѕР±РёСЂР°РµС‚ СЃРµСЂРІРµСЂ (`org-conversion-core.ts`) РёР· СЂРµР°Р»СЊРЅС‹С… РґР°РЅРЅС‹С…: СЃСЂРѕРєРѕРІ,
 * С‡РёСЃР»Р° СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ, РґРµР№СЃС‚РІСѓСЋС‰РёС… РїСЂР°РІРёР» РІРѕР·РЅР°РіСЂР°Р¶РґРµРЅРёСЏ.
 */

const GROUPS: Array<{ key: ConsequenceGroup; title: string; icon: typeof Coins }> = [
  { key: "payment", title: "РћРїР»Р°С‚Р°", icon: CreditCard },
  { key: "seats", title: "РњРµСЃС‚Р° РІ С‚Р°СЂРёС„Рµ", icon: Users },
  { key: "commission", title: "Р’РѕР·РЅР°РіСЂР°Р¶РґРµРЅРёРµ", icon: Coins },
  { key: "access", title: "Р”РѕСЃС‚СѓРї", icon: KeyRound },
  { key: "next", title: "Р”Р°Р»СЊС€Рµ", icon: ArrowRight },
];

export function ConversionConsequences({ consequences }: { consequences: Consequences }) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const locale = useLocale();
  const groupTitles = {
    payment: t("partnerConversion.consequenceGroups.payment"),
    seats: t("partnerConversion.consequenceGroups.seats"),
    commission: t("partnerConversion.consequenceGroups.commission"),
    access: t("partnerConversion.consequenceGroups.access"),
    next: t("partnerConversion.consequenceGroups.next"),
  };
  const localizedGroups = GROUPS.map((group) => ({ ...group, title: groupTitles[group.key] }));
  return (
    <div className="space-y-3" data-testid="conversion-consequences">
      {localizedGroups.filter((group) => consequences[group.key].length > 0).map((group) => {
        const presentation = consequences.presentation?.[group.key];
        const lines = presentation?.length
          ? presentation.map((line) => ({ key: line.key, text: localizeConsequence(line, t, locale) }))
          : consequences[group.key].map((text, index) => ({ key: `${group.key}-${index}`, text }));
        return (
        <div key={group.key} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
            <group.icon className="size-3.5 text-[#5566f6]" aria-hidden />
            {group.title}
          </div>
          <ul className="mt-1.5 space-y-1.5 text-[13.5px] leading-[1.5] text-[#3c4053]">
            {lines.map((line) => (
              <li key={line.key} className="flex gap-2">
                <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-[#5566f6]" aria-hidden />
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
        );
      })}
    </div>
  );
}

export function ConversionBlockers({ blockers, title }: { blockers: Blocker[]; title: string }) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const locale = useLocale();
  if (blockers.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[#ffe2a0] bg-[#fff8eb] px-4 py-3" data-testid="conversion-blockers">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#9a4a06]">
        <AlertTriangle className="size-4" aria-hidden />
        {title}
      </div>
      <ul className="mt-1.5 space-y-1.5 text-[13px] leading-[1.5] text-[#3c4053]">
        {blockers.map((blocker) => (
          <li key={blocker.code} data-blocker={blocker.code}>
            {localizedBlocker(blocker.code, blocker.presentation, locale, t)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function localizeConsequence(
  line: ConsequenceLine,
  t: ReturnType<typeof useTranslations<"settingsManagement.organizationProfile">>,
  locale: string,
): string {
  const date = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
  const amount = (value: number) => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value);

  switch (line.key) {
    case "subscriptionPaid": return t("partnerConversion.consequences.subscriptionPaid", { date: date(line.params.date) });
    case "subscriptionResponsibility": return t("partnerConversion.consequences.subscriptionResponsibility");
    case "accountPaidUntil": return t("partnerConversion.consequences.accountPaidUntil", { date: date(line.params.date) });
    case "recurringDisabled": return t("partnerConversion.consequences.recurringDisabled");
    case "lifetimeDiscount": return t("partnerConversion.consequences.lifetimeDiscount", { code: line.params.code });
    case "balanceRetained": return t("partnerConversion.consequences.balanceRetained", { amount: amount(line.params.amount) });
    case "accountSeats": return t("partnerConversion.consequences.accountSeats", {
      organizationCount: line.params.organizationCount, before: line.params.before, after: line.params.after,
    });
    case "organizationSeats": return t("partnerConversion.consequences.organizationSeats", { count: line.params.count });
    case "seatLimit": return t("partnerConversion.consequences.seatLimit", { limit: line.params.limit });
    case "rewardIntro": return t("partnerConversion.consequences.rewardIntro");
    case "rewardsByProgram": return t("partnerConversion.consequences.rewardsByProgram");
    case "subscriptionReward": return t("partnerConversion.consequences.subscriptionReward", {
      percent: line.params.percent, months: line.params.months,
    });
    case "subscriptionRewardNoLimit": return t("partnerConversion.consequences.subscriptionRewardNoLimit", { percent: line.params.percent });
    case "bonusReward": return t("partnerConversion.consequences.bonusReward", {
      amount: amount(line.params.amount), paymentNumber: line.params.paymentNumber,
    });
    case "hardwareReward": return t("partnerConversion.consequences.hardwareReward", { percent: line.params.percent });
    case "preConversionNoReward": return t("partnerConversion.consequences.preConversionNoReward");
    case "organizationRemoved": return t("partnerConversion.consequences.organizationRemoved", line.params);
    case "partnerAccess": return t("partnerConversion.consequences.partnerAccess");
    case "clientControls": return t("partnerConversion.consequences.clientControls");
    case "teamAccess": return t("partnerConversion.consequences.teamAccess", line.params);
    case "profileMoves": return t("partnerConversion.consequences.profileMoves", line.params);
    case "settingsUnchanged": return t("partnerConversion.consequences.settingsUnchanged");
    case "handoffOwner": return t("partnerConversion.consequences.handoffOwner");
    case "returnRules": return t("partnerConversion.consequences.returnRules");
    case "returnPayment": return t("partnerConversion.consequences.returnPayment");
    case "returnPaidUntil": return t("partnerConversion.consequences.returnPaidUntil", { date: date(line.params.date) });
    case "returnRecurring": return t("partnerConversion.consequences.returnRecurring");
    case "returnSeats": return t("partnerConversion.consequences.returnSeats", {
      total: line.params.total, current: line.params.current, organizationCount: line.params.organizationCount,
    });
    case "returnNewAccountSeats": return t("partnerConversion.consequences.returnNewAccountSeats", { count: line.params.count });
    case "returnCommission": return t("partnerConversion.consequences.returnCommission");
    case "returnOwner": return t("partnerConversion.consequences.returnOwner", line.params);
    case "returnInviteCancelled": return t("partnerConversion.consequences.returnInviteCancelled", line.params);
  }
}

function localizedBlocker(
  code: Blocker["code"],
  presentation: Blocker["presentation"],
  locale: string,
  t: ReturnType<typeof useTranslations<"settingsManagement.organizationProfile">>,
) {
  if (presentation) {
    const date = (value: string, withTime = false, withYear = false) => new Intl.DateTimeFormat(locale, {
      timeZone: "Europe/Moscow", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}),
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(value));
    switch (presentation.key) {
      case "pending_invoice":
        return t("partnerConversion.blockers.pending_invoice", {
          invoiceId: presentation.params.invoiceId,
          amount: new Intl.NumberFormat(locale, { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(presentation.params.amountRub),
        });
      case "pending_invoice_due":
        return t("partnerConversion.blockers.pending_invoice_due", {
          invoiceId: presentation.params.invoiceId,
          amount: new Intl.NumberFormat(locale, { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(presentation.params.amountRub),
          dueDate: date(presentation.params.dueDate, false, true),
        });
      case "pending_card_payment":
        return t("partnerConversion.blockers.pending_card_payment", {
          orderId: presentation.params.orderId,
          startedAt: date(presentation.params.startedAt, true),
          availableAt: date(presentation.params.availableAt, true),
        });
      case "recent_payment":
        return t("partnerConversion.blockers.recent_payment", {
          orderId: presentation.params.orderId,
          minutes: presentation.params.minutes,
        });
      case "team_lives_here":
        return t("partnerConversion.blockers.team_lives_here", {
          names: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(presentation.params.names),
        });
      case "other_partner":
        return t("partnerConversion.blockers.other_partner", { partnerName: presentation.params.partnerName });
      case "owned_by_client":
        return t("partnerConversion.blockers.owned_by_client", { ownerEmail: presentation.params.ownerEmail });
      case "seat_limit":
        return t("partnerConversion.blockers.seat_limit", {
          limit: presentation.params.limit, total: presentation.params.total, organizationName: presentation.params.organizationName,
        });
    }
  }
  // Legacy serialized blockers may lack parameters; never mix raw Russian source copy into another locale.
  switch (code) {
    case "pending_invoice":
    case "pending_card_payment":
    case "recent_payment":
    case "team_lives_here":
    case "other_partner":
    case "owned_by_client":
    case "seat_limit":
      return t("partnerConversion.blockers.unknown");
    case "not_partner": return t("partnerConversion.blockers.not_partner");
    case "not_owner": return t("partnerConversion.blockers.not_owner");
    case "foreign_mode": return t("partnerConversion.blockers.foreign_mode");
    case "demo": return t("partnerConversion.blockers.demo");
    case "directory": return t("partnerConversion.blockers.directory");
    case "platform": return t("partnerConversion.blockers.platform");
    case "deletion_requested": return t("partnerConversion.blockers.deletion_requested");
    case "partner_inn": return t("partnerConversion.blockers.partner_inn");
    case "applicant_organization": return t("partnerConversion.blockers.applicant_organization");
    case "already_client": return t("partnerConversion.blockers.already_client");
    case "only_organization": return t("partnerConversion.blockers.only_organization");
    case "link_missing": return t("partnerConversion.blockers.link_missing");
    case "not_converted": return t("partnerConversion.blockers.not_converted");
    case "converted_by_other": return t("partnerConversion.blockers.converted_by_other");
    case "paid_after_conversion": return t("partnerConversion.blockers.paid_after_conversion");
  }
}
