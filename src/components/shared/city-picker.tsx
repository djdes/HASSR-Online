"use client";

/**
 * Поле «Город» с подсказками (спека tg-client-location-2026-11): регистрация
 * и настройки организации. Город из каталога задаёт часовой пояс — по нему
 * журналы ставят время. Пустое поле с `autoFill` подставляет город по поясу
 * браузера, а затем — по IP (`/api/public/place-hint`), если человек ещё
 * ничего не ввёл. Тексты — от родителя: поле живёт и на публичной
 * странице, и в кабинете, у них разные словари.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";

import { browserTimeZone, findGeoPlace, guessPlaceByTimeZone, suggestGeoPlaces, type GeoPlace } from "@/lib/geo-places";
import { countryName, localTimeLabel, utcOffsetLabel } from "@/lib/ip-geo";

export type CityValue = { city: string; countryCode: string | null };

export function CityPicker({
  id,
  value,
  onChange,
  onPlace,
  locale = "ru",
  placeholder,
  autoFill = false,
  inputClassName,
  invalid,
}: {
  id?: string;
  value: CityValue;
  onChange: (value: CityValue) => void;
  /** Выбран город из каталога — его пояс (родитель обновит часовой пояс). */
  onPlace?: (place: GeoPlace) => void;
  locale?: string;
  placeholder?: string;
  autoFill?: boolean;
  inputClassName?: string;
  invalid?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? `city-${autoId}`;
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const suggestions = useMemo(() => {
    const list = suggestGeoPlaces(value.city, 8);
    // Ровно выбранный город — список не нужен.
    return list.length === 1 && list[0].city === value.city ? [] : list;
  }, [value.city]);

  // Автоподстановка: сначала по поясу браузера (мгновенно), потом по IP.
  useEffect(() => {
    if (!autoFill || valueRef.current.city) return;
    const byZone = guessPlaceByTimeZone(browserTimeZone());
    if (byZone) {
      onChange({ city: byZone.city, countryCode: byZone.countryCode });
      onPlace?.(byZone);
    }
    const controller = new AbortController();
    fetch("/api/public/place-hint", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { place?: { city?: string | null; countryCode?: string | null } | null } | null) => {
        const hint = data?.place;
        if (!hint?.city || typed.current) return;
        const known = findGeoPlace(hint.city, hint.countryCode);
        if (!known) return;
        onChange({ city: known.city, countryCode: known.countryCode });
        onPlace?.(known);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // Один раз при появлении поля.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFill]);

  function choose(place: GeoPlace) {
    typed.current = true;
    onChange({ city: place.city, countryCode: place.countryCode });
    onPlace?.(place);
    setOpen(false);
  }

  const now = new Date();
  return (
    <div className="relative">
      <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" aria-hidden="true" />
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid ? true : undefined}
        autoComplete="address-level2"
        value={value.city}
        placeholder={placeholder}
        data-testid="city-picker"
        onChange={(event) => {
          typed.current = true;
          const city = event.target.value;
          const known = findGeoPlace(city);
          onChange({ city, countryCode: known?.countryCode ?? null });
          if (known) onPlace?.(known);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(suggestions[active] ?? suggestions[0]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`${inputClassName ?? ""} pl-10`}
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto rounded-2xl border border-[#dcdfed] bg-white p-1 shadow-[0_16px_40px_-16px_rgba(11,16,36,0.25)] dark:border-white/10 dark:bg-[#141726]"
        >
          {suggestions.map((place, index) => (
            <li
              key={`${place.countryCode}:${place.city}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(place);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-[14px] ${
                index === active ? "bg-[#f1f2fb] newd:bg-[#f1f1f4] dark:bg-white/10" : ""
              }`}
            >
              <span className="min-w-0 truncate text-[#0b1024] dark:text-white">
                {place.city}
                <span className="text-[#8a8ea4]"> · {countryName(place.countryCode, locale) ?? place.countryCode}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[12.5px] text-[#8a8ea4]">
                {localTimeLabel(place.timeZone, now)} {utcOffsetLabel(place.timeZone, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
