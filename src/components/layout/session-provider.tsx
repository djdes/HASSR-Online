"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { JournalControlsProvider } from "@/components/journals/journal-controls-provider";
import { BrakerageSetupPrompt } from "@/components/journals/brakerage-setup-prompt";

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
      <JournalControlsProvider><BrakerageSetupPrompt />{children}</JournalControlsProvider>
    </SessionProvider>
  );
}
