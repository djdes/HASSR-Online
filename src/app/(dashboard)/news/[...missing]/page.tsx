import { notFound } from "next/navigation";

/**
 * Неизвестный адрес внутри раздела кабинета: «Такой страницы нет» рисуется
 * внутри макета (`(dashboard)/not-found.tsx`) — меню и шапка остаются на месте.
 * Без ловушки адрес уходил на корневой 404 без меню.
 */
export default function MissingSectionPage() {
  notFound();
}
