import { Suspense, type ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

/**
 * Раздел «Производственный контроль». Слот `modal` — окно пункта структуры ППК
 * (`@modal/(.)item/[id]`): ссылка пункта с обзора открывается поверх страницы,
 * прямой заход — страница `item/[id]`.
 *
 * Своя граница загрузки у окна (владелец, 2026-11-24: «при нажатии на ссылки
 * сначала скролит вверх, а потом открывается окно»): пока окно пункта
 * приходит с сервера, ждёт только оно. Без неё ожидание поднималось до
 * скелета всего кабинета — обзор прятался, высота страницы падала до экрана,
 * и прокрутка сбрасывалась наверх.
 */
export default function ProductionControlLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <DomainMessagesBoundary namespaces={["productionControl", "productionControlUi"]}>
      {children}
      <Suspense fallback={null}>{modal}</Suspense>
    </DomainMessagesBoundary>
  );
}
