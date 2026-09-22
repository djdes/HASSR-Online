import { listCoreJournalRecipients, notifyCoreJournalRecipients } from "@/lib/core-journal-keepers";
import type { HealthDecision } from "@/lib/health-qr";
import { upsertNotification } from "@/lib/notifications";

/**
 * Сигнал ответственному о подписи сотрудника в гигиеническом журнале —
 * одинаково для QR и TasksFlow (2026-09-22):
 *  • колокольчик «ждут допуска» — одна карточка на документ и день, в ней
 *    все, кто подписал (повторная подпись обновляет пункт);
 *  • жалобы или просроченная медкнижка — сразу колокольчик, Telegram и почта.
 */
export async function notifyHygieneDeclaration(params: {
  organizationId: string;
  hygieneDocumentId: string | null;
  employee: { id: string; name: string };
  todayKey: string;
  /** «ЧЧ:ММ» по поясу организации. */
  at: string;
  decision: Pick<HealthDecision, "admitted" | "complaints">;
  via: "QR" | "TasksFlow";
  medExpired?: boolean;
}): Promise<void> {
  const { organizationId, hygieneDocumentId, employee, todayKey, at, decision, via } = params;
  const recipients = await listCoreJournalRecipients(organizationId, hygieneDocumentId).catch(() => []);
  const linkHref = hygieneDocumentId ? `/journals/hygiene/documents/${hygieneDocumentId}` : "/journals";

  if (hygieneDocumentId) {
    await Promise.all(
      recipients.map((recipient) =>
        upsertNotification({
          organizationId,
          userId: recipient.id,
          kind: "hygiene-admission",
          dedupeKey: `hygiene-admission:${hygieneDocumentId}:${todayKey}`,
          title: "Гигиенический журнал: сотрудники ждут допуска",
          linkHref,
          linkLabel: "Открыть журнал",
          items: [
            {
              id: employee.id,
              label: decision.admitted
                ? `${employee.name} — подписал, ждёт допуска`
                : `${employee.name} — жалобы: ${decision.complaints.join(", ")}`,
              hint: at,
            },
          ],
        }).catch(() => null)
      )
    );
  }

  if (decision.admitted && !params.medExpired) return;
  const title = decision.admitted ? `${employee.name}: просрочена медкнижка` : `${employee.name} не допущен(а) к работе`;
  const reason = decision.admitted ? "медкнижка просрочена" : decision.complaints.join(", ");
  await notifyCoreJournalRecipients({
    organizationId,
    recipients,
    kind: "health-qr-suspended",
    dedupeKey: `health-qr:${todayKey}:${employee.id}:${decision.admitted ? "med" : "suspended"}`,
    title,
    items: [{ id: employee.id, label: `${employee.name} — ${reason}`, hint: at }],
    linkHref,
    linkLabel: "Открыть журнал",
    telegramText: `⚠️ ${title}\nПричина: ${reason} (отметка через ${via} в ${at}).`,
    emailSubject: title,
    emailBodyHtml: `<p>Сотрудник <strong>${escapeHtml(employee.name)}</strong> отметился через ${via} в ${at}.</p><p>Причина: ${escapeHtml(reason)}.</p><p>В гигиеническом журнале стоит «${decision.admitted ? "Здоров" : "Отстранён"}». Примите решение о допуске и при необходимости поправьте запись.</p>`,
  }).catch(() => null);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
