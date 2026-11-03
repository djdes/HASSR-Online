import { SeoJournalLanding, getSeoMetadata, SEO_LANDINGS } from "@/components/landing/seo-journal-landing";

const config = SEO_LANDINGS["zhurnal-sutochnyh-prob"];

export const metadata = getSeoMetadata(config);

export default function Page() {
  return <SeoJournalLanding config={config} />;
}
