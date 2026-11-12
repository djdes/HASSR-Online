"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { JournalControlsProvider } from "@/components/journals/journal-controls-provider";
import { BrakerageSetupPrompt } from "@/components/journals/brakerage-setup-prompt";
import { ServerSessionSync } from "@/components/layout/server-session-sync";

export function AuthSessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session;
}) {
  return (
    <SessionProvider
      session={session}
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
      refetchInterval={0}
    >
      {/* Смена организации без перезагрузки: `useSession()` догоняет сессию из layout. */}
      <ServerSessionSync session={session} />
      <JournalControlsProvider><BrakerageSetupPrompt />{children}</JournalControlsProvider>
    </SessionProvider>
  );
}
