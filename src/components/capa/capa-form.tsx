"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CAPA_TEMPLATES, CAPA_CATEGORIES, CAPA_PRIORITIES, capaErrorKey, readCapaFormData } from "./capa-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSubmitLock } from "@/lib/use-submit-lock";

/**
 * Срок устранения, который подразумевает сам приоритет — ровно те
 * часы, что написаны в его подписи («Критический (2ч)»). Раньше выбор
 * «Критический» оставлял в поле срока прежние 24 часа, и подпись
 * приоритета противоречила сроку прямо в одной форме.
 */
export const PRIORITY_SLA_HOURS: Record<string, string> = {
  critical: "2",
  high: "24",
  medium: "48",
  low: "72",
};

/** Приоритет по умолчанию — от него же берётся и срок устранения. */
export const DEFAULT_PRIORITY = "medium";

interface Props {
  users: { id: string; name: string }[];
}

export function CapaForm({ users }: Props) {
  const t = useTranslations("capaManagement");
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  // Двойной тап по «Создать нарушение» заводил две карточки: `useState`
  // применяется к следующему рендеру, и оба клика успевали отправить POST.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<ReturnType<typeof capaErrorKey> | null>(null);
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [category, setCategory] = useState("other");
  // Срок по умолчанию — из приоритета по умолчанию, одним словарём.
  // Раньше стояло «24» при приоритете «Средний (48ч)» — подписи спорили.
  const [slaHours, setSlaHours] = useState(PRIORITY_SLA_HOURS[DEFAULT_PRIORITY]);
  const [assignedToId, setAssignedToId] = useState("");
  const [templateId, setTemplateId] = useState("");
  // Человек сам выставил срок — больше его не трогаем.
  const [slaTouched, setSlaTouched] = useState(false);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = CAPA_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    if (titleRef.current) titleRef.current.value = t(`templates.${tpl.id}.title`);
    if (descRef.current) descRef.current.value = t(`templates.${tpl.id}.description`);
    setPriority(tpl.priority);
    setCategory(tpl.category);
    setSlaHours(tpl.slaHours);
    setSlaTouched(false);
  }

  function handlePriorityChange(next: string) {
    setPriority(next);
    if (slaTouched) return;
    const hours = PRIORITY_SLA_HOURS[next];
    if (hours) setSlaHours(hours);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/capa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readCapaFormData(form, { priority, category, slaHours, assignedToId })),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(capaErrorKey(data?.error, res.status, data?.code));
        return;
      }
      const ticket = await res.json();
      router.push(`/capa/${ticket.id}`);
    } catch {
      setError("saveFailed");
    } finally {
      release();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}

      <div className="space-y-2">
        <Label htmlFor="capa-template">{t("form.template")}</Label>
        <Select value={templateId} onValueChange={applyTemplate}>
          <SelectTrigger id="capa-template">
            <SelectValue placeholder={t("form.templatePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {CAPA_TEMPLATES.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {t(`templates.${template.id}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[12px] text-[#6f7282]">
          {t("form.templateHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">{t("form.title")}</Label>
        <Input
          id="title"
          name="title"
          required
          ref={titleRef}
          placeholder={t("form.titlePlaceholder")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t("fields.description")}</Label>
        <Textarea
          id="description"
          name="description"
          ref={descRef}
          rows={6}
          placeholder={t("form.descriptionPlaceholder")}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="capa-priority">{t("form.priority")}</Label>
          <Select value={priority} onValueChange={handlePriorityChange}>
            <SelectTrigger id="capa-priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAPA_PRIORITIES.map(value => <SelectItem key={value} value={value}>{t(`prioritySla.${value}`, { hours: Number(PRIORITY_SLA_HOURS[value]) })}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="capa-category">{t("form.category")}</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="capa-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAPA_CATEGORIES.map(value => <SelectItem key={value} value={value}>{t(`categories.${value}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="capa-sla">{t("form.deadline")}</Label>
          <Select
            value={slaHours}
            onValueChange={(next) => {
              setSlaTouched(true);
              setSlaHours(next);
            }}
          >
            <SelectTrigger id="capa-sla"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2, 24, 48, 72].map(hours => <SelectItem key={hours} value={String(hours)}>{t("hours", { hours })}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="capa-assignee">{t("form.assignee")}</Label>
          <Select value={assignedToId} onValueChange={setAssignedToId}>
            <SelectTrigger id="capa-assignee"><SelectValue placeholder={t("form.select")} /></SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.creating") : t("form.create")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/capa")}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
