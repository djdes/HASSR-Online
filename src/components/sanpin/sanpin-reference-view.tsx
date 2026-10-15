import { BookOpen } from "lucide-react";
import { createTranslator } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SANPIN_NORMS, type SanPinNorm } from "@/lib/sanpin-norms";
import { formatNumber, type Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import { presentSanpinNorm, SANPIN_REFERENCE_CATEGORIES } from "./sanpin-reference-presentation";

/** Pure server-rendered reference: no client catalog or live translation calls. */
export function SanpinReferenceView({ locale, messages, norms = SANPIN_NORMS }: {
  locale: Locale;
  messages: Messages["sanpinReference"];
  norms?: readonly SanPinNorm[];
}) {
  const t = createTranslator({ locale, messages: { sanpinReference: messages }, namespace: "sanpinReference", onError: error => { throw error; } });
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <BookOpen aria-hidden className="size-6 text-primary" />
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">{t("title")}</h1>
        </div>
        <p className="mt-1 text-muted-foreground">{t("description")}</p>
      </div>
      <div className="space-y-6">
        {SANPIN_REFERENCE_CATEGORIES.map(category => {
          const categoryNorms = norms.filter(norm => norm.category === category.key);
          if (categoryNorms.length === 0) return null;
          return (
            <Card key={category.key}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  <span aria-hidden>{category.emoji}</span>
                  {t(`categories.${category.key}`)}
                  <Badge variant="secondary" className="ml-auto">{formatNumber(locale, categoryNorms.length)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {categoryNorms.map(source => {
                    const norm = presentSanpinNorm(source, messages);
                    return (
                      <div key={norm.id} data-norm-id={norm.id} className="space-y-2 rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="min-w-0 text-sm font-semibold">{norm.title}</h3>
                          {norm.values && <Badge variant="outline" className="shrink-0 whitespace-normal break-words font-mono text-xs">{norm.values}</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{norm.description}</p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <BookOpen aria-hidden className="size-3 shrink-0" />
                          <span>{t("source", { document: norm.document, section: norm.section })}</span>
                        </div>
                        {norm.penalty && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{t("penalty", { penalty: norm.penalty })}</div>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
