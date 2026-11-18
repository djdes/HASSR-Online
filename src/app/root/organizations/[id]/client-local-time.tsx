"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { localTimeLabel, utcOffsetLabel } from "@/lib/ip-geo";

/**
 * Местное время клиента рядом с телефоном (спека tg-client-location-2026-11):
 * видно, удобно ли звонить. Пояс — по IP входа клиента, иначе пояс
 * организации. Сервер рисует первое значение, дальше часы идут сами.
 */
export function ClientLocalTime({
  timeZone,
  place,
  initial,
  title,
}: {
  timeZone: string;
  place: string | null;
  initial: string;
  title: string;
}) {
  const [time, setTime] = useState(initial);
  useEffect(() => {
    const tick = () => setTime(localTimeLabel(timeZone));
    tick();
    const timer = window.setInterval(tick, 20_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#f1f2fb] px-2 py-0.5 text-[12.5px] text-[#3c4053] newd:bg-[#f1f1f4]"
      title={`${title}: ${timeZone} (${utcOffsetLabel(timeZone)})`}
      data-testid="owner-local-time"
    >
      <Clock className="size-3.5 text-[#8a8ea4]" aria-hidden="true" />
      <span className="tabular-nums font-medium text-[#0b1024]">{time}</span>
      {place ? <span className="truncate text-[#8a8ea4]">{place}</span> : null}
    </span>
  );
}
