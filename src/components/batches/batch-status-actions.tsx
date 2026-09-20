"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_TRANSITIONS: Record<string, { label: string; next: string; variant?: "default" | "outline" | "destructive" }[]> = {
  received: [
    { label: "В производство", next: "in_production" },
    { label: "Списать", next: "written_off", variant: "destructive" },
  ],
  in_production: [
    { label: "Готово", next: "finished" },
    { label: "Списать", next: "written_off", variant: "destructive" },
  ],
  finished: [
    { label: "Отгрузить", next: "shipped" },
    { label: "Списать", next: "written_off", variant: "destructive" },
  ],
};

interface Props {
  batchId: string;
  currentStatus: string;
}

export function BatchStatusActions({ batchId, currentStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState("");

  const transitions = STATUS_TRANSITIONS[currentStatus] || [];
  if (transitions.length === 0) return null;

  async function changeStatus(newStatus: string) {
    setLoading(newStatus);
    try {
      const res = await fetch(`/api/batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
      }
      router.refresh();
    } catch {
      // ignore
    } finally {
      setLoading("");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Действия</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          {transitions.map((t) => (
            <Button
              key={t.next}
              variant={t.variant || "default"}
              onClick={() => changeStatus(t.next)}
              disabled={!!loading}
            >
              {loading === t.next && <Loader2 className="size-4 animate-spin" />}
              {t.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
