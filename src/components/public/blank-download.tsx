import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { BlankDownloadClient, type BlankDownloadClientProps } from "./blank-download-client";

export type { BlankDownloadClientProps };

/** Keep this public feature namespace at its leaf instead of serializing it globally. */
export function BlankDownloadButton(props: BlankDownloadClientProps) {
  return (
    <DomainMessagesBoundary namespaces={["publicBlankDownload"]}>
      <BlankDownloadClient {...props} />
    </DomainMessagesBoundary>
  );
}
