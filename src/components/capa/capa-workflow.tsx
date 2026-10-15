"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CAPA_WORKFLOW, capaWorkflowStep, capaWorkflowPayload, capaErrorKey } from "./capa-presentation";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Suggestion = { title: string; text: string };

interface Props {
  ticketId: string;
  currentStatus: string;
}

export function CapaWorkflow({ ticketId, currentStatus }: Props) {
  const t = useTranslations("capaManagement");
  const locale = useLocale();
  const router = useRouter();
  const [fieldValue, setFieldValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReturnType<typeof capaErrorKey> | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const stepKey = capaWorkflowStep(currentStatus);
  if (!stepKey) return null;
  const step = CAPA_WORKFLOW[stepKey];

  async function handleSuggest() {
    if (!step.suggestStep) return;
    setSuggesting(true);
    setSuggestions(null);
    try {
      const res = await fetch(
        `/api/capa/${ticketId}/suggest?step=${step.suggestStep}&locale=${locale}`,
        { method: "POST" }
      );
      const data = (await res.json()) as {
        suggestions?: Suggestion[];
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        toast.error(t(`errors.${capaErrorKey(data.error, res.status, data.code, "suggestFailed")}`));
        return;
      }
      setSuggestions(data.suggestions ?? []);
    } catch {
      toast.error(t("errors.suggestFailed"));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAdvance() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/capa/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capaWorkflowPayload(currentStatus, fieldValue)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        setError(capaErrorKey(data?.error, res.status, data?.code));
        return;
      }
      router.refresh();
    } catch {
      setError("saveFailed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("workflow.nextStep")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={`capa-${ticketId}-${step.field}`}>{t(`workflow.${stepKey}.field`)}</Label>
            {step.suggestStep ? (
              <button
                type="button"
                onClick={handleSuggest}
                disabled={suggesting}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f6ff] px-3 py-1 text-[12px] font-medium text-[#3848c7] hover:bg-[#eef1ff] disabled:opacity-50"
              >
                {suggesting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                {t("workflow.suggest")}
              </button>
            ) : null}
          </div>
          <Textarea
            value={fieldValue}
            onChange={(e) => setFieldValue(e.target.value)}
            id={`capa-${ticketId}-${step.field}`}
            placeholder={t(`workflow.${stepKey}.placeholder`)}
          />
          {suggestions && suggestions.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3">
              <div className="flex items-center justify-between text-[12px] text-[#6f7282]">
                <span>{t("workflow.suggestions")}</span>
                <button
                  type="button"
                  onClick={() => setSuggestions(null)}
                  className="text-[#9b9fb3] hover:text-[#0b1024]"
                >
                  {t("workflow.hide")}
                </button>
              </div>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFieldValue(s.text)}
                  className="block w-full rounded-xl border border-[#ececf4] bg-white p-3 text-left transition-all hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <div className="text-[13px] font-semibold text-[#0b1024]">
                    {s.title}
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-[#3c4053]">
                    {s.text}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button onClick={handleAdvance} disabled={loading}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {t(`workflow.${stepKey}.label`)}
        </Button>
      </CardContent>
    </Card>
  );
}
