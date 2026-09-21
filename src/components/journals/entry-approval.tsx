"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

interface EntryApprovalActionsProps {
  entryId: string;
  currentStatus: string;
  userRole: string;
  journalCode: string;
}

export function EntryApprovalActions({
  entryId,
  currentStatus,
  userRole,
  journalCode,
}: EntryApprovalActionsProps) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState("");

  const canApprove = (userRole === "owner" || userRole === "technologist") && currentStatus === "submitted";

  if (!canApprove) return null;

  async function handleAction(newStatus: string) {
    const isApprove = newStatus === "approved";
    if (isApprove) setIsApproving(true);
    else setIsRejecting(true);
    setError("");

    try {
      const res = await fetch(`/api/journals/${entryId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "\u041e\u0448\u0438\u0431\u043a\u0430");
      }

      router.push(`/journals/${journalCode}`);
      router.refresh();
    } catch (err) {
      setError(humanizeFetchError(err, "\u041e\u0448\u0438\u0431\u043a\u0430"));
    } finally {
      setIsApproving(false);
      setIsRejecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{"\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0437\u0430\u043f\u0438\u0441\u0438"}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-3 text-sm text-destructive">{error}</p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => handleAction("approved")}
            disabled={isApproving || isRejecting}
            className="bg-green-600 hover:bg-green-700"
          >
            {isApproving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {"\u0423\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c"}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleAction("draft")}
            disabled={isApproving || isRejecting}
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            {isRejecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <XCircle className="size-4" />
            )}
            {"\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u043d\u0430 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0443"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
