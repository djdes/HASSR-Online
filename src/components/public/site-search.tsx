import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { SiteSearchClient } from "./site-search-client";

/** Кнопка «Поиск» с окном поиска по сайту; словарь — только своего раздела. */
export function SiteSearch({ variant }: { variant?: "header" | "home" }) {
  return (
    <DomainMessagesBoundary namespaces={["publicSearch"]}>
      <SiteSearchClient variant={variant} />
    </DomainMessagesBoundary>
  );
}
