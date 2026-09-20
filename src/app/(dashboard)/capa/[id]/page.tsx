import Link from "next/link";
import { PageCrumbs } from "@/components/layout/page-nav";
import { notFound } from "next/navigation";
import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CapaWorkflow } from "@/components/capa/capa-workflow";

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  open: { label: "Открыто", color: "bg-red-100 text-red-800" },
  investigating: { label: "Расследование", color: "bg-yellow-100 text-yellow-800" },
  corrective_action: { label: "Корректировка", color: "bg-blue-100 text-blue-800" },
  verification: { label: "Верификация", color: "bg-purple-100 text-purple-800" },
  closed: { label: "Закрыто", color: "bg-green-100 text-green-800" },
};

const PRIORITY_INFO: Record<string, string> = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const CATEGORY_LABELS: Record<string, string> = {
  temperature: "Температура",
  hygiene: "Гигиена",
  packaging: "Упаковка",
  quality: "Качество",
  process: "Процесс",
  equipment: "Оборудование",
  other: "Другое",
};

export default async function CapaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth();

  const ticket = await db.capaTicket.findUnique({ where: { id } });
  if (!ticket || ticket.organizationId !== getActiveOrgId(session)) {
    notFound();
  }

  const slaDeadline = new Date(ticket.createdAt.getTime() + ticket.slaHours * 60 * 60 * 1000);
  const slaBreached = ticket.status !== "closed" && Date.now() > slaDeadline.getTime();
  const statusInfo = STATUS_INFO[ticket.status] || { label: ticket.status, color: "" };

  const steps = [
    { key: "open", label: "Открыто", done: true },
    { key: "investigating", label: "Расследование", done: ["investigating", "corrective_action", "verification", "closed"].includes(ticket.status) },
    { key: "corrective_action", label: "Корректировка", done: ["corrective_action", "verification", "closed"].includes(ticket.status) },
    { key: "verification", label: "Верификация", done: ["verification", "closed"].includes(ticket.status) },
    { key: "closed", label: "Закрыто", done: ticket.status === "closed" },
  ];

  return (
    <div className="space-y-5">
      <PageCrumbs
        items={[
          { label: "Нарушения", href: "/capa" },
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
            <Badge variant="outline">{PRIORITY_INFO[ticket.priority] || ticket.priority}</Badge>
            <Badge variant="outline">{CATEGORY_LABELS[ticket.category] || ticket.category}</Badge>
          </div>
        </div>
      </div>

      {/* SLA warning */}
      {slaBreached && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="size-4" />
          Срок нарушен! Нужно было закрыть до: {slaDeadline.toLocaleString("ru-RU")}
        </div>
      )}

      {/* Progress steps */}
      <div className="flex items-center gap-1">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1 flex-1">
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
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">SLA</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5">
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{ticket.slaHours} ч</span>
              <span className="text-xs text-muted-foreground">
                (до {slaDeadline.toLocaleString("ru-RU")})
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Создано</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{ticket.createdAt.toLocaleString("ru-RU")}</p></CardContent>
        </Card>
      </div>

      {ticket.description && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Описание</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.description}</p></CardContent>
        </Card>
      )}

      {/* Filled fields */}
      <div className="space-y-3">
        {ticket.rootCause && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Корневая причина</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.rootCause}</p></CardContent>
          </Card>
        )}
        {ticket.correctiveAction && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Корректирующее действие</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.correctiveAction}</p></CardContent>
          </Card>
        )}
        {ticket.preventiveAction && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Предупреждающее действие</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.preventiveAction}</p></CardContent>
          </Card>
        )}
        {ticket.verificationResult && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Результат верификации</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{ticket.verificationResult}</p></CardContent>
          </Card>
        )}
      </div>

      {/* Workflow actions */}
      <CapaWorkflow ticketId={ticket.id} currentStatus={ticket.status} />
    </div>
  );
}
