/**
 * Запоминание «свёрнуто / развёрнуто» у секций главной (`DashboardSection`,
 * нативный `<details data-storage-key>`), на этом устройстве, в localStorage.
 *
 * Два входа, одна логика:
 *  • inline-скрипт `DashboardSectionPersistScript` — при полной загрузке
 *    страницы. Ставит сохранённое состояние сразу, как секция появилась в
 *    DOM (MutationObserver срабатывает до первой отрисовки), а не на
 *    `DOMContentLoaded`: раньше свёрнутая секция успевала мелькнуть
 *    развёрнутой, пока догружался хвост страницы.
 *  • `DashboardSectionMemory` (клиентский помощник внутри секции) — при
 *    переходе на главную внутри приложения: скрипт, вставленный React, не
 *    исполняется, а layout-effect успевает до отрисовки.
 * Оба помечают элемент `__persistAttached`, поэтому второй вызов — пустой.
 */

export const DASHBOARD_SECTION_STORAGE_PREFIX = "wesetup.dashboard.section.";

type SectionElement = {
  open: boolean;
  dataset: { storageKey?: string };
  addEventListener(type: "toggle", listener: () => void): void;
  __persistAttached?: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Сохранённое значение → открыта ли секция; `null` — не сохраняли, берём по умолчанию. */
export function savedSectionOpen(saved: string | null): boolean | null {
  if (saved === "1") return true;
  if (saved === "0") return false;
  return null;
}

export function attachDashboardSectionMemory(
  details: SectionElement,
  storage: StorageLike | null,
): void {
  if (details.__persistAttached || !details.dataset.storageKey) return;
  details.__persistAttached = true;
  const key = DASHBOARD_SECTION_STORAGE_PREFIX + details.dataset.storageKey;
  let saved: string | null = null;
  try {
    saved = storage?.getItem(key) ?? null;
  } catch {
    // Приватный режим / запрет хранилища — остаётся состояние по умолчанию.
  }
  const open = savedSectionOpen(saved);
  if (open !== null && details.open !== open) details.open = open;
  // Пишем только настоящую смену состояния. Браузер шлёт `toggle` и сам:
  // на `<details open>` из разметки и на нашу же подстановку выше — без
  // этой проверки «открыто» записывалось, хотя человек ничего не нажимал.
  let last = details.open;
  details.addEventListener("toggle", () => {
    if (details.open === last) return;
    last = details.open;
    try {
      storage?.setItem(key, details.open ? "1" : "0");
    } catch {
      // Не записали — в следующий раз откроется по умолчанию.
    }
  });
}

/**
 * Тот же алгоритм строкой для inline-скрипта (без зависимостей: работает до
 * загрузки JS приложения). Наблюдатель живёт до `DOMContentLoaded` — к этому
 * моменту вся разметка страницы уже в DOM, дальше хватает помощника в секции.
 */
export const DASHBOARD_SECTION_PERSIST_SCRIPT = `
(function(){
  try {
    var prefix = '${DASHBOARD_SECTION_STORAGE_PREFIX}';
    function attach(d) {
      if (d.__persistAttached || !d.dataset.storageKey) return;
      d.__persistAttached = true;
      var key = prefix + d.dataset.storageKey;
      var saved = null;
      try { saved = localStorage.getItem(key); } catch (e) {}
      if (saved === '1' && !d.open) d.open = true;
      else if (saved === '0' && d.open) d.open = false;
      var last = d.open;
      d.addEventListener('toggle', function(){
        if (d.open === last) return;
        last = d.open;
        try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (e) {}
      });
    }
    function scan(root) {
      if (root.matches && root.matches('details[data-storage-key]')) attach(root);
      if (root.querySelectorAll) root.querySelectorAll('details[data-storage-key]').forEach(attach);
    }
    scan(document);
    if (document.readyState === 'loading') {
      var observer = new MutationObserver(function(records){
        records.forEach(function(r){
          r.addedNodes.forEach(function(n){ if (n.nodeType === 1) scan(n); });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', function(){
        observer.disconnect();
        scan(document);
      });
    }
  } catch (e) { /* fail silently */ }
})();`;
