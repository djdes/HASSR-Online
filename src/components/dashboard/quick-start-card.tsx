import { getCoreSetupStatus } from "@/lib/onboarding-core-status";
import { QuickStartCardCompact } from "./quick-start-card-client";

/**
 * Карточка «Начальная настройка» на `/dashboard`.
 *
 * Показывает прогресс по тем же шагам, что и быстрый старт, и ИСЧЕЗАЕТ,
 * когда настройка закончена: три этапа пройдены и документы журналов
 * созданы. Условие считает `getCoreSetupStatus` — один источник правды со
 * страницей `/settings/onboarding`.
 *
 * Раньше здесь был свой чек-лист из шестнадцати пунктов: продукты,
 * пайплайны, чек-листы, TasksFlow, Telegram, автосоздание, расписание.
 * Карточка пряталась, только когда закрыто ВСЁ, поэтому висела вечно —
 * владелец видел на онбординге три «ГОТОВО», а на главной «71%, завершите
 * настройку». Тонкая настройка никуда не делась, она живёт на
 * `/settings/onboarding/advanced`, но звать в неё с главной каждый день
 * незачем: без неё сервис работает.
 */
export async function QuickStartCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const status = await getCoreSetupStatus(organizationId);

  if (status.setupFinished) return null;

  // Шаги ровно в том составе, в каком они стоят на странице быстрого
  // старта, плюс документы журналов и шаг «Приказы и чек-листы» (фаза
  // «Документы») — иначе процент на главной и на онбординге разъедутся.
  const steps = [
    status.buildings.state === "complete",
    status.equipment.state === "complete",
    status.positions.state === "complete",
    status.users.state === "complete",
    status.journals.state === "complete",
    status.activeDocumentsCount >= 1,
    // «Приказы и чек-листы»: обязательные приказы сферы оформлены и
    // чек-листы отмечены проверенными.
    status.documents.done,
  ];

  return (
    <QuickStartCardCompact
      completed={steps.filter(Boolean).length}
      total={steps.length}
    />
  );
}
