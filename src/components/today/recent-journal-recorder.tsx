"use client";

import { useEffect } from "react";

import { RECENT_JOURNALS_KEY, parseRecentJournals, pushRecentJournal } from "@/lib/recent-journals";

/** Открыли журнал — запоминаем на устройстве для «Недавно открывали» на «Сегодня». */
export function RecentJournalRecorder({ code }: { code: string }) {
  useEffect(() => {
    try {
      const next = pushRecentJournal(parseRecentJournals(window.localStorage.getItem(RECENT_JOURNALS_KEY)), code);
      window.localStorage.setItem(RECENT_JOURNALS_KEY, JSON.stringify(next));
    } catch {
      /* приватный режим или запрет хранилища — без «недавних» */
    }
  }, [code]);
  return null;
}
