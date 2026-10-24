import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadBaseMessages, loadMessages } from "@/i18n/messages";
import { FORMAT_LOCALES, formatNumber } from "@/i18n/locales";
import { batchUnitCode, isBatchStatus, type BatchStatus } from "@/components/batches/batch-presentation";
import Link from "next/link";
import { PageCrumbs } from "@/components/layout/page-nav";
import { notFound } from "next/navigation";
import { Package } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BatchStatusActions } from "@/components/batches/batch-status-actions";

const STATUS_VARIANTS: Record<BatchStatus, "default" | "secondary" | "outline" | "destructive"> = {
  received: "secondary",
  in_production: "default",
  finished: "default",
  shipped: "outline",
  expired: "destructive",
  written_off: "destructive",
};

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth();
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "productionBatches" });
  const [sourceMessages, messages] = await Promise.all([loadBaseMessages("ru"), loadMessages(locale)]);
  // Translate only recognized standard names; preserve customer-authored names.
  const displayJournalName = (code: string, name: string) => {
    const key = code as keyof typeof sourceMessages.journals.names;
    return Object.hasOwn(sourceMessages.journals.names, code) && sourceMessages.journals.names[key] === name
      ? messages.journals.names[key] : name;
  };
  const dateFormat = new Intl.DateTimeFormat(FORMAT_LOCALES[locale]);
  const dateTimeFormat = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { dateStyle: "short", timeStyle: "medium" });

  const batch = await db.batch.findUnique({ where: { id } });
  if (!batch || batch.organizationId !== getActiveOrgId(session)) {
    notFound();
  }

  const unitCode = batchUnitCode(batch.unit);
  const displayUnit = unitCode ? t(`units.${unitCode}`) : batch.unit;

  // Find related journal entries
  const relatedEntries = await db.journalEntry.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      data: { path: ["batchCode"], equals: batch.code },
    },
    include: {
      template: { select: { name: true, code: true } },
      filledBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  return (
    <div className="space-y-5">
      <PageCrumbs
        items={[
          { label: t("title"), href: "/batches" },
          { label: batch.code },
        ]}
      />
      <div className="flex items-center gap-3">
                <div className="flex-1">
          <div className="flex items-center gap-2">
            <Package className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-bold font-mono">{batch.code}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{batch.productName}</p>
        </div>
        <Badge variant={isBatchStatus(batch.status) ? STATUS_VARIANTS[batch.status] : "outline"} className="text-sm">
          {isBatchStatus(batch.status) ? t(`statuses.${batch.status}`) : batch.status}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">{t("supplier")}</CardTitle>
          </CardHeader>
          <CardContent><p className="font-medium text-sm">{batch.supplier || "—"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">{t("quantity")}</CardTitle>
          </CardHeader>
          <CardContent><p className="font-medium text-sm">{formatNumber(locale, batch.quantity, { maximumFractionDigits: 20 })} {displayUnit}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">{t("receivedDate")}</CardTitle>
          </CardHeader>
          <CardContent><p className="font-medium text-sm">{dateFormat.format(batch.receivedAt)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">{t("expiryDate")}</CardTitle>
          </CardHeader>
          <CardContent><p className="font-medium text-sm">{batch.expiryDate ? dateFormat.format(batch.expiryDate) : "—"}</p></CardContent>
        </Card>
      </div>

      {batch.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("notes")}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm">{batch.notes}</p></CardContent>
        </Card>
      )}

      <BatchStatusActions batchId={batch.id} currentStatus={batch.status} />

      {/* Traceability chain */}
      {relatedEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("traceability")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {relatedEntries.map((entry: (typeof relatedEntries)[number]) => (
                <Link
                  key={entry.id}
                  href={`/journals/${entry.template.code}/${entry.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{displayJournalName(entry.template.code, entry.template.name)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("entryAuthor", { date: dateTimeFormat.format(entry.createdAt), name: entry.filledBy.name })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
