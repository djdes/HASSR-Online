import type { Metadata } from "next";

import { OfflineApp } from "@/components/offline/app/offline-app";

/**
 * Screen for working with no network. The cabinet service worker stores
 * this page on the device and shows it when a navigation fails, so its
 * HTML must stay the same for everyone: no session, no organization, no
 * names here — personal data is read on the device from IndexedDB.
 *
 * The path starts with `/mini` on purpose: the worker is registered with
 * scope `/mini`, and a scope matches by prefix.
 */
export const metadata: Metadata = {
  title: "Работа без связи",
  robots: { index: false, follow: false },
};

export default function MiniOfflinePage() {
  return <OfflineApp />;
}
