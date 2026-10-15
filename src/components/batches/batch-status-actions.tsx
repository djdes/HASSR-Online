"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { batchErrorKey } from "./batch-presentation";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const STATUS_TRANSITIONS: Record<string, { next: "in_production" | "written_off" | "finished" | "shipped"; variant?: "default" | "outline" | "destructive" }[]> = {
  received: [
    { next: "in_production" },
    { next: "written_off", variant: "destructive" },
  ],
  in_production: [
    { next: "finished" },
    { next: "written_off", variant: "destructive" },
  ],
  finished: [
    { next: "shipped" },
    { next: "written_off", variant: "destructive" },
  ],
};

interface Props {
  batchId: string;
  currentStatus: string;
}

export function BatchStatusActions({ batchId, currentStatus }: Props) {
  const t = useTranslations("productionBatches");
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [error, setError] = useState<ReturnType<typeof batchErrorKey> | null>(null);

  const transitions = Object.hasOwn(STATUS_TRANSITIONS, currentStatus) ? STATUS_TRANSITIONS[currentStatus] : [];
  if (transitions.length === 0) return null;

  async function changeStatus(newStatus: string) {
    setLoading(newStatus);
    setError(null);
    try {
      const res = await fetch(`/api/batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(batchErrorKey(data?.error, res.status));
        return;
      }
      router.refresh();
    } catch {
      setError("saveFailed");
    } finally {
      setLoading("");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("actions.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="mb-2 text-sm text-destructive">{t(`errors.${error}`)}</p>}
        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <Button
              key={transition.next}
              variant={transition.variant || "default"}
              onClick={() => changeStatus(transition.next)}
              disabled={!!loading}
            >
              {loading === transition.next && <Loader2 className="size-4 animate-spin" />}
              {t(`actions.${transition.next}`)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
