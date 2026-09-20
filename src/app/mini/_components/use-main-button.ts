"use client";

import { useEffect, useRef, useState } from "react";

import { getTelegramWebApp, isInsideTelegram } from "./telegram-web-app";

/**
 * Главная кнопка Telegram вместо своей внизу экрана.
 *
 * Она рисуется самим клиентом: живёт ниже нашего полотна, не уезжает
 * под клавиатуру, имеет родной индикатор ожидания и свою тактильность.
 * Для человека это разница между «сайт в окне» и «приложение».
 *
 * Опасность у неё ровно одна, зато серьёзная: состояние глобальное, на
 * уровне WebApp, а не страницы. Кнопка, не убранная при уходе с экрана,
 * останется на следующем — с прежней надписью, и нажатие уйдёт в
 * размонтированный компонент. Поэтому снятие обработчика и `hide()`
 * здесь безусловные, а обработчик держится в ref: пересоздавать
 * подписку на каждый рендер формы значит терять нажатие в момент
 * подмены.
 *
 * Вне Telegram хук просто ничего не делает и возвращает `false` —
 * вызывающий обязан оставить свою кнопку. Обе ветки живые: в браузере
 * Mini App открывают регулярно.
 */
export function useMainButton({
  text,
  visible = true,
  enabled = true,
  loading = false,
  onClick,
}: {
  text: string;
  visible?: boolean;
  enabled?: boolean;
  /** Показывать родной индикатор ожидания вместо своего. */
  loading?: boolean;
  onClick: () => void;
}): boolean {
  const handler = useRef(onClick);
  useEffect(() => {
    handler.current = onClick;
  }, [onClick]);

  // Наличие кнопки выясняем после монтирования: на сервере
  // `window` нет, и рендер разошёлся бы с гидратацией ровно на том,
  // показывать ли свою кнопку.
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    // Вне Telegram объект тоже есть, а кнопки на экране нет: полагаться
    // на него значит спрятать свою кнопку и оставить форму без отправки.
    setAvailable(isInsideTelegram() && Boolean(getTelegramWebApp()?.MainButton));
  }, []);

  useEffect(() => {
    const button = getTelegramWebApp()?.MainButton;
    if (!button) return;

    const onPress = () => handler.current();
    try {
      button.onClick(onPress);
    } catch {
      /* old client */
    }
    return () => {
      try {
        button.offClick(onPress);
        button.hideProgress();
        button.hide();
      } catch {
        /* old client */
      }
    };
  }, []);

  useEffect(() => {
    const button = getTelegramWebApp()?.MainButton;
    if (!button) return;
    try {
      button.setText(text);
      if (enabled && !loading) button.enable();
      else button.disable();
      if (loading) button.showProgress(false);
      else button.hideProgress();
      if (visible) button.show();
      else button.hide();
    } catch {
      /* old client */
    }
  }, [text, visible, enabled, loading]);

  return available;
}
