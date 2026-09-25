"use client";

/**
 * Подпись под неактивной кнопкой сохранения на QR-странице: чего не хватает
 * («Не выбран сотрудник», «Не указана температура», «Опишите, что сделали»).
 * Серой кнопки без объяснения человек не понимает — как на экране задачи.
 */
export function SaveBlockedReason({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p role="status" data-testid="qr-save-reason" className="mt-2 text-center text-[15px] font-medium leading-snug text-[#a13a32]">
      {reason}
    </p>
  );
}
