/**
 * Зелёная анимированная галка экрана «Сохранено» на QR-формах: круг
 * рисуется обводкой, затем галка, лёгкий «pop». При
 * `prefers-reduced-motion` — сразу готовая. Ключевые кадры —
 * `.qr-success-*` в `globals.css`.
 */
export function SuccessCheck({ label = "Сохранено" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="qr-success-pop mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-[#ecfdf5] text-[#16a34a]"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-14"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle className="qr-success-circle" cx="12" cy="12" r="10" />
        <path className="qr-success-mark" d="m8 12.5 2.7 2.7L16.5 9.5" />
      </svg>
    </div>
  );
}
