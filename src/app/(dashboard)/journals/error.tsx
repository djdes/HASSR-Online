"use client";

import { JournalRouteError } from "@/components/journals/journal-route-error";

export default function JournalsError({
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
      variant="journals"
      backHref="/dashboard"
    />
  );
}
