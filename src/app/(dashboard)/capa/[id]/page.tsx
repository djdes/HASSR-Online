import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { FORMAT_LOCALES } from "@/i18n/locales";
import { PageCrumbs } from "@/components/layout/page-nav";
import { notFound } from "next/navigation";
import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CapaWorkflow } from "@/components/capa/capa-workflow";


export default async function CapaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth();
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "capaManagement" });
  const STATUS_INFO: Record<string, { label: string; color: string }> = {
    open: { label: t("statuses.open"), color: "bg-red-100 text-red-800" },
    investigating: { label: t("statuses.investigating"), color: "bg-yellow-100 text-yellow-800" },
    corrective_action: { label: t("statuses.corrective_action"), color: "bg-blue-100 text-blue-800" },
    verification: { label: t("statuses.verification"), color: "bg-purple-100 text-purple-800" },
    rejected: { label: t("statuses.rejected"), color: "" },
    closed: { label: t("statuses.closed"), color: "bg-green-100 text-green-800" },
  };

  const PRIORITY_INFO: Record<string, string> = {
    critical: t("priorities.critical"),
    high: t("priorities.high"),
    medium: t("priorities.medium"),
    low: t("priorities.low"),
  };

  const CATEGORY_LABELS: Record<string, string> = {
    temperature: t("categories.temperature"),
    hygiene: t("categories.hygiene"),
    packaging: t("categories.packaging"),
    quality: t("categories.quality"),
    process: t("categories.process"),
    equipment: t("categories.equipment"),
    training: t("categories.training"),
    other: t("categories.other"),
  };

  const dateFormat = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { dateStyle: "short", timeStyle: "medium" });

  const ticket = await db.capaTicket.findUnique({ where: { id } });
  if (!ticket || ticket.organizationId !== getActiveOrgId(session)) {
    notFound();
  }

  const slaDeadline = new Date(ticket.createdAt.getTime() + ticket.slaHours * 60 * 60 * 1000);
  const slaBreached = ticket.status !== "closed" && Date.now() > slaDeadline.getTime();
  const statusInfo = Object.hasOwn(STATUS_INFO, ticket.status) ? STATUS_INFO[ticket.status] : { label: ticket.status, color: "" };

  const steps = [
    { key: "open", label: t("statuses.open"), done: true },
    { key: "investigating", label: t("statuses.investigating"), done: ["investigating", "corrective_action", "verification", "closed"].includes(ticket.status) },
    { key: "corrective_action", label: t("statuses.corrective_action"), done: ["corrective_action", "verification", "closed"].includes(ticket.status) },
    { key: "verification", label: t("statuses.verification"), done: ["verification", "closed"].includes(ticket.status) },
    { key: "closed", label: t("statuses.closed"), done: ticket.status === "closed" },
  ];

  return (
    <div className="space-y-5">
      <PageCrumbs
        items={[
          { label: t("title"), href: "/capa" },
          { label: ticket.title },
        ]}
      />
      <div className="flex items-center gap-3">
                <div className="flex-1">
          <h1 className="text-xl font-bold">{ticket.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
            <Badge variant="outline">{Object.hasOwn(PRIORITY_INFO, ticket.priority) ? PRIORITY_INFO[ticket.priority] : ticket.priority}</Badge>
            <Badge variant="outline">{Object.hasOwn(CATEGORY_LABELS, ticket.category) ? CATEGORY_LABELS[ticket.category] : ticket.category}</Badge>
          </div>
        </div>
      </div>

      {/* SLA warning */}
      {slaBreached && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="size-4" />
          {t("slaBreached", { deadline: dateFormat.format(slaDeadline) })}
        </div>
      )}

      {/* Progress steps */}
      <div className="flex flex-wrap items-center gap-3">
        {steps.map((step, i) => (
          <div key={step.key} className="flex min-w-[120px] flex-1 items-center gap-1">
            <div className={`flex items-center justify-center rounded-full size-6 text-xs font-medium ${
              step.done ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"
            }`}>
              {step.done ? <CheckCircle2 className="size-4" /> : i + 1}
            </div>
            <span className={`text-xs ${step.done ? "text-green-700" : "text-muted-foreground"}`}>
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${step.done ? "bg-green-400" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{t("sla")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5">
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("hours", { hours: ticket.slaHours })}</span>
              <span className="text-xs text-muted-foreground">
                {t("dueBy", { deadline: dateFormat.format(slaDeadline) })}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{t("created")}</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{dateFormat.format(ticket.createdAt)}</p></CardContent>
        </Card>
      </div>

      {ticket.description && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("fields.description")}</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.description}</p></CardContent>
        </Card>
      )}

      {/* Filled fields */}
      <div className="space-y-3">
        {ticket.rootCause && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("fields.rootCause")}</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.rootCause}</p></CardContent>
          </Card>
        )}
        {ticket.correctiveAction && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("fields.correctiveAction")}</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.correctiveAction}</p></CardContent>
          </Card>
        )}
        {ticket.preventiveAction && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("fields.preventiveAction")}</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.preventiveAction}</p></CardContent>
          </Card>
        )}
        {ticket.verificationResult && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("fields.verificationResult")}</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.verificationResult}</p></CardContent>
          </Card>
        )}
      </div>

      {/* Workflow actions */}
      <CapaWorkflow ticketId={ticket.id} currentStatus={ticket.status} />
    </div>
  );
}
