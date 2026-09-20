"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SuggestStep = "root_cause" | "corrective" | "preventive" | null;

const WORKFLOW: Record<
  string,
  {
    nextStatus: string;
    nextLabel: string;
    field: string;
    fieldLabel: string;
    fieldPlaceholder: string;
    suggestStep: SuggestStep;
  }
> = {
  open: {
    nextStatus: "investigating",
    nextLabel: "Начать расследование",
    field: "rootCause",
    fieldLabel: "Предварительная оценка",
    fieldPlaceholder: "Опишите предварительные наблюдения...",
    suggestStep: null,
  },
  investigating: {
    nextStatus: "corrective_action",
    nextLabel: "Назначить корректировку",
    field: "rootCause",
    fieldLabel: "Корневая причина",
    fieldPlaceholder: "5 Why: почему произошло отклонение?",
    suggestStep: "root_cause",
  },
  corrective_action: {
    nextStatus: "verification",
    nextLabel: "На верификацию",
    field: "correctiveAction",
    fieldLabel: "Корректирующее действие",
    fieldPlaceholder: "Что было сделано для устранения?",
    suggestStep: "corrective",
  },
  verification: {
    nextStatus: "closed",
    nextLabel: "Закрыть нарушение",
    field: "verificationResult",
    fieldLabel: "Результат верификации",
    fieldPlaceholder: "Подтвердите, что проблема устранена",
    suggestStep: null,
  },
};

type Suggestion = { title: string; text: string };

interface Props {
  ticketId: string;
  currentStatus: string;
}

export function CapaWorkflow({ ticketId, currentStatus }: Props) {
  const router = useRouter();
  const [fieldValue, setFieldValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const step = WORKFLOW[currentStatus];
  if (!step) return null;

  async function handleSuggest() {
    if (!step.suggestStep) return;
    setSuggesting(true);
    setSuggestions(null);
    try {
      const res = await fetch(
        `/api/capa/${ticketId}/suggest?step=${step.suggestStep}`,
        { method: "POST" }
      );
      const data = (await res.json()) as {
        suggestions?: Suggestion[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка");
      }
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAdvance() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/capa/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: step.nextStatus,
          [step.field]: fieldValue || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
      }
      router.refresh();
    } catch {
      setError("Не удалось обновить статус");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Следующий шаг</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{step.fieldLabel}</Label>
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
                AI: предложить варианты
              </button>
            ) : null}
          </div>
          <Textarea
            value={fieldValue}
            onChange={(e) => setFieldValue(e.target.value)}
            placeholder={step.fieldPlaceholder}
          />
          {suggestions && suggestions.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3">
              <div className="flex items-center justify-between text-[12px] text-[#6f7282]">
                <span>AI-варианты — кликните чтобы вставить в форму:</span>
                <button
                  type="button"
                  onClick={() => setSuggestions(null)}
                  className="text-[#9b9fb3] hover:text-[#0b1024]"
                >
                  скрыть
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
          {step.nextLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
