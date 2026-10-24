import Link from "next/link";
import { ClipboardCheck, ClipboardX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Props = { organizationId: string };

/**
 * Server component. Renders a red/green roll-up of how many journals were
 * filled today for the current organisation, plus a short list of unfilled
 * codes with names. Powered by the same aggregation logic as
 * /api/external/summary but inlined here to avoid an HTTP round-trip.
 */
export async function JournalsTodayWidget({ organizationId }: Props) {
  const tToday = await getTranslations("dashboardUi.journalsTodayWidget");
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(day);
  nextDay.setUTCDate(day.getUTCDate() + 1);

  const [templates, documents, entryCounts] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        dateFrom: { lte: day },
        dateTo: { gte: day },
      },
      select: { id: true, templateId: true },
    }),
    db.journalDocumentEntry.groupBy({
      by: ["documentId"],
      where: {
        date: { gte: day, lt: nextDay },
        document: { organizationId, status: "active" },
        ...NOT_AUTO_SEEDED,
      },
      _count: { _all: true },
    }),
  ]);

  const entriesByDoc = new Map(
    entryCounts.map((row) => [row.documentId, row._count._all])
  );
  const docsByTemplate = new Map<string, string[]>();
  for (const doc of documents) {
    const list = docsByTemplate.get(doc.templateId) ?? [];
    list.push(doc.id);
    docsByTemplate.set(doc.templateId, list);
  }

  const rows = templates
    .map((t) => {
      const docIds = docsByTemplate.get(t.id) || [];
      const entries = docIds.reduce(
        (sum, id) => sum + (entriesByDoc.get(id) || 0),
        0
      );
      return {
        code: t.code,
        name: t.name,
        hasDocument: docIds.length > 0,
        filled: entries > 0,
      };
    })
    .sort((a, b) => (a.filled === b.filled ? 0 : a.filled ? 1 : -1));

  const totalActive = rows.filter((r) => r.hasDocument).length;
  const filled = rows.filter((r) => r.filled).length;
  const unfilled = rows.filter((r) => r.hasDocument && !r.filled);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-green-600" />
          {tToday("title")}
          <Badge variant="secondary" className="ml-1 h-5 px-2 text-[11px]">
            {filled}/{totalActive}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {unfilled.length === 0 ? (
          <p className="text-muted-foreground">{tToday("allFilled")}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-amber-700">
              <ClipboardX className="size-4" />
              <span>{tToday("notStarted", { count: unfilled.length })}</span>
            </div>
            <ul className="space-y-1">
              {unfilled.slice(0, 8).map((row) => (
                <li key={row.code}>
                  <Link
                    href={`/journals/${row.code}`}
                    className="text-[#5863f8] hover:underline"
                  >
                    {row.name}
                  </Link>
                </li>
              ))}
              {unfilled.length > 8 ? (
                <li className="text-muted-foreground">{tToday("andMore", { count: unfilled.length - 8 })}</li>
              ) : null}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
