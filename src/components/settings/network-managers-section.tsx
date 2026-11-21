import { getLocale, getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import { accountRoleOf, loadNetworkManagers } from "@/lib/account-roles.server";
import { formatNetworkDay } from "@/lib/network-summary";

import { NetworkManagersClient } from "./network-managers-client";

/**
 * «Управляющие сетью» на странице «Сеть» (серия E, Р5): владелец аккаунта
 * назначает и снимает управляющих из руководителей организаций аккаунта с
 * полным доступом. Управляющему сетью и остальным блок не показывается.
 */
export async function NetworkManagersSection({ accountId, viewerId }: { accountId: string; viewerId: string }) {
  if ((await accountRoleOf(viewerId, accountId)) !== "owner") return null;
  const [view, t, locale] = await Promise.all([
    loadNetworkManagers(accountId),
    getTranslations("settingsManagement.network.managers"),
    getLocale() as Promise<Locale>,
  ]);
  return (
    <NetworkManagersClient
      managers={view.managers.map((manager) => ({
        userId: manager.userId,
        name: manager.name,
        email: manager.email,
        organizations: manager.organizations.join(", "),
        active: manager.active,
        since: t("since", { date: formatNetworkDay(new Date(manager.createdAt), locale) }),
      }))}
      candidates={view.candidates.map((candidate) => ({
        userId: candidate.userId,
        name: candidate.name,
        label: candidate.organizations.length
          ? t("candidate", { name: candidate.name, organizations: candidate.organizations.join(", ") })
          : candidate.name,
      }))}
      labels={{
        title: t("title"),
        description: t("description"),
        empty: t("empty"),
        inactive: t("inactive"),
        choose: t("choose"),
        add: t("add"),
        noCandidates: t("noCandidates"),
        remove: t("remove"),
        // С «{name}» — имя подставляет клиент.
        removeTitle: String(t.raw("removeTitle")),
        removeDescription: t("removeDescription"),
        added: String(t.raw("added")),
        removed: String(t.raw("removed")),
        failed: t("failed"),
      }}
    />
  );
}
