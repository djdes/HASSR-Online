import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { CallbackButtonClient } from "./callback-button-client";

/** «Перезвоните мне» — кнопка с окном заявки; словарь — только своего раздела. */
export function CallbackButton(props: { place: string; tone?: "dark" | "light"; topic?: string }) {
  return (
    <DomainMessagesBoundary namespaces={["publicCallback"]}>
      <CallbackButtonClient {...props} />
    </DomainMessagesBoundary>
  );
}
