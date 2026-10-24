"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("journalUi.entryApproval");
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
        throw new Error(data.error || t("error"));
      }

      router.push(`/journals/${journalCode}`);
      router.refresh();
    } catch (err) {
      setError(humanizeFetchError(err, t("error")));
    } finally {
      setIsApproving(false);
      setIsRejecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
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
            {t("approve")}
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
            {t("returnToDraft")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
