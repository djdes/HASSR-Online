import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { BlankConstructorClient } from "./blank-constructor-client";

/** Конструктор бланка: свои колонки и строки, PDF через окно с почтой. */
export function BlankConstructor(props: { code: string; title: string }) {
  return (
    <DomainMessagesBoundary namespaces={["publicBlankDownload", "blankConstructor"]}>
      <BlankConstructorClient {...props} />
    </DomainMessagesBoundary>
  );
}
