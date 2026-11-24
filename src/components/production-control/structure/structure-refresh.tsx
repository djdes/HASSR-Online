"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const OVERVIEW = "/production-control";

/**
 * Статусы пунктов обзора обновляются, когда окно пункта закрыто: пока окно
 * открыто, его редакторы держат своё состояние, а изменения копятся
 * (`ppk:changed`); вернулись на обзор — один `router.refresh()`.
 */
export function PpkStructureRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const dirty = useRef(false);

  useEffect(() => {
    const mark = () => {
      dirty.current = true;
    };
    window.addEventListener("ppk:changed", mark);
    return () => window.removeEventListener("ppk:changed", mark);
  }, []);

  useEffect(() => {
    if (pathname === OVERVIEW && dirty.current) {
      dirty.current = false;
      router.refresh();
    }
  }, [pathname, router]);

  return null;
}
