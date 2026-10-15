"use client";

import { JournalRouteError } from "@/components/journals/journal-route-error";

export default function JournalCodeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <JournalRouteError
      error={error}
      reset={reset}
      variant="documents"
      backHref="/journals"
    />
  );
}
