/** Stable route-to-message mapping for navigation labels. Customer section names remain runtime data. */
const SECTION_LABEL_KEYS = {
  "/plans": "sections.plans.label",
  "/capa": "sections.capa.label",
  "/reports": "sections.reports.label",
  "/ideas": "sections.ideas.label",
  "/settings": "sections.settings.label",
  "/settings/integrations/tasksflow": "sections.tasksflow.label",
} as const;

const SECTION_HINT_KEYS = {
  "/journals": "sections.journals.hint",
  "/control-board": "sections.controlBoard.hint",
  "/verifications": "sections.verifications.hint",
  "/journals-progress": "sections.journalsProgress.hint",
  "/team": "sections.team.hint",
  "/settings/schedule": "sections.schedule.hint",
  "/plans": "sections.plans.hint",
  "/capa": "sections.capa.hint",
  "/orders": "sections.orders.hint",
  "/mercury": "sections.mercury.hint",
  "/sanpin": "sections.sanpin.hint",
  "/reports": "sections.reports.hint",
  "/settings/balance": "sections.balance.hint",
  "/ideas": "sections.ideas.hint",
  "/settings": "sections.settings.hint",
  "/settings/users": "sections.users.hint",
  "/settings/journals": "sections.journalSettings.hint",
  "/settings/permissions": "sections.permissions.hint",
  "/settings/integrations/tasksflow": "sections.tasksflow.hint",
  "/settings/equipment": "sections.equipment.hint",
  "/settings/areas": "sections.areas.hint",
  "/settings/products": "sections.products.hint",
  "/settings/buildings": "sections.buildings.hint",
  "/settings/notifications": "sections.notifications.hint",
  "/settings/audit": "sections.audit.hint",
  "/settings/security": "sections.security.hint",
  "/settings/subscription": "sections.subscription.hint",
  "/settings/appearance": "sections.appearance.hint",
  "/dashboard/catch-up": "sections.catchUp.hint",
  "/dashboard/compliance-audit": "sections.complianceAudit.hint",
} as const;

type SectionLabelKey = (typeof SECTION_LABEL_KEYS)[keyof typeof SECTION_LABEL_KEYS];
type SectionHintKey = (typeof SECTION_HINT_KEYS)[keyof typeof SECTION_HINT_KEYS];

export function navigationSectionLabelKey(href: string): SectionLabelKey | undefined {
  return Object.hasOwn(SECTION_LABEL_KEYS, href) ? SECTION_LABEL_KEYS[href as keyof typeof SECTION_LABEL_KEYS] : undefined;
}

export function navigationSectionHintKey(href: string): SectionHintKey | undefined {
  return Object.hasOwn(SECTION_HINT_KEYS, href) ? SECTION_HINT_KEYS[href as keyof typeof SECTION_HINT_KEYS] : undefined;
}
