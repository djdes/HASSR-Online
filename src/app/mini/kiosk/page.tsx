import { KioskScreen } from "./kiosk-screen";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

/**
 * Общий планшет: экран выбора сотрудника и ввода ПИН. Доступен по
 * device-cookie `wesetup.kiosk` (страница анонимна на краю, как весь /mini;
 * данные отдаёт /api/kiosk/roster только валидному киоску).
 */
export default function MiniKioskPage() {
  return (
    <DomainMessagesBoundary namespaces={["miniKiosk"]}>
      <KioskScreen />
    </DomainMessagesBoundary>
  );
}
