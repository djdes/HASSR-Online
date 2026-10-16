"use client";

import { createContext, useContext } from "react";
import type { NavModel } from "@/lib/app-nav.server";

const EMPTY: NavModel = { sections: [], showSidebar: false };

const AppNavContext = createContext<NavModel>(EMPTY);

/** Меню кабинета, собранное на сервере (`buildNavModel`), — для клиента. */
export function AppNavProvider({ model, children }: { model: NavModel; children: React.ReactNode }) {
  return <AppNavContext.Provider value={model}>{children}</AppNavContext.Provider>;
}

export function useAppNav(): NavModel {
  return useContext(AppNavContext);
}
