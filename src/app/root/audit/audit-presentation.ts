import type { Locale } from "@/i18n/locales";

const ACTION_KEYS = {
  "onboarding.apply-preset": "actionOnboardingApplyPreset",
  "staff.bulk-import": "actionStaffBulkImport",
  "settings.tasksflow.connect": "actionSettingsTasksflowConnect",
  "settings.tasksflow.disconnect": "actionSettingsTasksflowDisconnect",
  "position.create": "actionPositionCreate",
  "position.delete": "actionPositionDelete",
  "user.invite": "actionUserInvite",
  "user.archive": "actionUserArchive",
  "journal.enable": "actionJournalEnable",
  "checklist.item.create": "actionChecklistItemCreate",
  "checklist.item.update": "actionChecklistItemUpdate",
  "checklist.item.delete": "actionChecklistItemDelete",
  "checklist.check.set": "actionChecklistCheckSet",
  "checklist.check.unset": "actionChecklistCheckUnset",
  "tasksflow.bulk_assign.force_wipe": "actionTasksflowBulkAssignForceWipe",
  "staff.archived.responsibles_orphan": "actionStaffArchivedResponsiblesOrphan",
  "promotion.create": "actionPromotionCreate",
  "promotion.update": "actionPromotionUpdate",
  "promotion.enable": "actionPromotionEnable",
  "promotion.disable": "actionPromotionDisable",
  "promotion.delete": "actionPromotionDelete",
  "promo.create": "actionPromoCreate",
  "promo.update": "actionPromoUpdate",
  "promo.enable": "actionPromoEnable",
  "promo.disable": "actionPromoDisable",
  "promo.lifetime.bind": "actionPromoLifetimeBind",
  "promo.lifetime.revoke": "actionPromoLifetimeRevoke",
  "mailing.campaign.launch": "actionMailingCampaignLaunch",
  "mailing.campaign.schedule": "actionMailingCampaignSchedule",
  "mailing.campaign.cancel": "actionMailingCampaignCancel",
  "mailing.campaign.retry": "actionMailingCampaignRetry",
  "mailing.campaign.test": "actionMailingCampaignTest",
  "mailing.draft.delete": "actionMailingDraftDelete",
  "mailing.contacts.import": "actionMailingContactsImport",
  "mailing.contact.update": "actionMailingContactUpdate",
  "mailing.contacts.delete": "actionMailingContactsDelete",
  "mailing.suppression.add": "actionMailingSuppressionAdd",
  "mailing.suppression.remove": "actionMailingSuppressionRemove",
  "mailing.settings.update": "actionMailingSettingsUpdate",
  "mailing.unsubscribe": "actionMailingUnsubscribe",
  "mailing.optin": "actionMailingOptin",
  "mailing.optout": "actionMailingOptout"
} as const;

export function auditActionKey(action: string) {
  return Object.hasOwn(ACTION_KEYS, action) ? ACTION_KEYS[action as keyof typeof ACTION_KEYS] : undefined;
}

export function auditActionLabel(action: string, t: (key: NonNullable<ReturnType<typeof auditActionKey>>) => string): string {
  const key = auditActionKey(action);
  return key === undefined ? action : t(key);
}

/** Only this page's explicit Moscow/full-seconds profile; keep native RU/EN and invalid output. */
export function formatAuditDate(date: Date, locale: Locale): string {
  const selected = locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : Number.isFinite(date.getTime()) ? "en-GB" : "uz-Latn-UZ";
  return date.toLocaleString(selected, { timeZone: "Europe/Moscow" });
}
