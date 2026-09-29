import { requireRoot } from "@/lib/auth-helpers";
import { BLANK_DOWNLOAD_AUDIT_ACTION } from "@/lib/blank-download";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Append-only audit-trail для root-админа платформы.
 * Источник истины — таблица AuditLog (заполняется через recordAuditLog).
 * Хранится 365 дней (cleanup через pruneOldAuditLogs).
 */

const ACTION_LABELS: Record<string, string> = {
  "onboarding.apply-preset": "Применён онбординг-шаблон",
  "staff.bulk-import": "Массовый импорт сотрудников",
  "settings.tasksflow.connect": "Подключение TasksFlow",
  "settings.tasksflow.disconnect": "Отключение TasksFlow",
  "position.create": "Создание должности",
  "position.delete": "Удаление должности",
  "user.invite": "Приглашение пользователя",
  "user.archive": "Архивирование пользователя",
  "journal.enable": "Журнал включён (QR шаблона / одним нажатием)",
  // Чек-листы (Phase 3) — каждое действие админа и сотрудника.
  "checklist.item.create": "Чек-лист: добавлен пункт",
  "checklist.item.update": "Чек-лист: обновлён пункт",
  "checklist.item.delete": "Чек-лист: удалён пункт",
  "checklist.check.set": "Чек-лист: пункт ОТМЕЧЕН сотрудником",
  "checklist.check.unset": "Чек-лист: пункт снят сотрудником",
  // Прочие важные действия которые уже логируются.
  "tasksflow.bulk_assign.force_wipe": "TasksFlow: force-wipe задач",
  "staff.archived.responsibles_orphan":
    "Архив сотрудника: освобождены слоты ответственных",
  // Акции на подписку (ROOT → «Акции»).
  "promotion.create": "Акция создана",
  "promotion.update": "Акция изменена",
  "promotion.enable": "Акция включена",
  "promotion.disable": "Акция выключена",
  "promotion.delete": "Акция удалена",
  // Рассылка (ROOT → «Рассылка»).
  "mailing.campaign.launch": "Рассылка запущена",
  "mailing.campaign.schedule": "Рассылка запланирована",
  "mailing.campaign.cancel": "Рассылка отменена",
  "mailing.campaign.retry": "Рассылка: повтор неудачных",
  "mailing.campaign.test": "Рассылка: тест себе",
  "mailing.draft.delete": "Рассылка: черновик удалён",
  "mailing.contacts.import": "Рассылка: загружены контакты",
  "mailing.contact.update": "Рассылка: контакт изменён",
  "mailing.contacts.delete": "Рассылка: контакты удалены",
  "mailing.suppression.add": "Стоп-лист: адрес добавлен",
  "mailing.suppression.remove": "Стоп-лист: адрес убран",
  "mailing.settings.update": "Рассылка: скорость отправки",
  "mailing.unsubscribe": "Отписка от рассылки",
  "mailing.optin": "Новости на почту включены",
  "mailing.optout": "Новости на почту выключены",
};

function formatDate(d: Date): string {
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

export default async function RootAuditPage() {
  await requireRoot();

  const logs = await db.auditLog.findMany({
    // Скачивания шаблонов с сайта — лиды, а не действия админов: у них
    // свой список (/root/blank-downloads), здесь они вытеснили бы аудит.
    where: { action: { not: BLANK_DOWNLOAD_AUDIT_ACTION } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const orgIds = [...new Set(logs.map((l) => l.organizationId))];
  const orgs = orgIds.length
    ? await db.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      })
    : [];
  const orgById = new Map(orgs.map((o) => [o.id, o.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-black">
          Audit log
        </h1>
        <p className="mt-2 text-[15px] text-[#6f7282]">
          Последние 200 действий. Хранится 365 дней.
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-2xl border border-[#ececf4] bg-white p-8 text-center text-[14px] text-[#6f7282]">
          Записей пока нет. AuditLog заполняется автоматически при админ-действиях.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead className="bg-[#f6f7fb] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Время</th>
                <th className="px-4 py-3 text-left font-medium">Организация</th>
                <th className="px-4 py-3 text-left font-medium">Кто</th>
                <th className="px-4 py-3 text-left font-medium">Действие</th>
                <th className="px-4 py-3 text-left font-medium">Сущность</th>
                <th className="px-4 py-3 text-left font-medium">Детали</th>
                <th className="px-4 py-3 text-left font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-[#f1f1f6] align-top">
                  <td className="px-4 py-3 text-[12px] text-[#6f7282] whitespace-nowrap">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#0b1024]">
                    {orgById.get(log.organizationId) ?? log.organizationId}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#0b1024]">
                    {log.userName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-medium text-[#5566f6]">
                    {ACTION_LABELS[log.action] ?? log.action}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#6f7282]">
                    {log.entity}{log.entityId ? `:${log.entityId.slice(0, 6)}` : ""}
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <pre className="overflow-x-auto rounded bg-[#f6f7fb] px-2 py-1 text-[11px] text-[#3a3f55]">
                      {JSON.stringify(log.details ?? {}, null, 0).slice(0, 200)}
                    </pre>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#6f7282]">
                    {log.ipAddress ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
