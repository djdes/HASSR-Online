"use client";

import { useEffect, useRef } from "react";
import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { needsClientSessionReread, rereadClientSession, sessionSignature } from "@/lib/client-session-sync";

/**
 * Держит `useSession()` вровень с сессией, которую прислал layout (2026-11-12):
 * после смены организации без перезагрузки клиент видит её организацию, роль и
 * права. Правила — `lib/client-session-sync.ts`. Ничего не рисует; без смены
 * не делает ни одного запроса.
 */
export function ServerSessionSync({ session }: { session: Session | null }) {
  const { data } = useSession();
  const server = sessionSignature(session);
  const client = sessionSignature(data);
  const previousServer = useRef(server);

  useEffect(() => {
    const previous = previousServer.current;
    previousServer.current = server;
    if (needsClientSessionReread({ previousServer: previous, server, client })) rereadClientSession();
  }, [server, client]);

  return null;
}
