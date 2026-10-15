/**
 * Скелетон списочного экрана Mini App: заголовок, подпись и карточки.
 *
 * Форма взята у экрана журнала, где она уже была написана внутри
 * компонента (`journals/[code]/page.tsx`) — а значит показывалась
 * только после монтирования клиента. Вынесена сюда, чтобы работать
 * и как `loading.tsx`, то есть в момент серверной навигации, когда
 * человек до этого видел белый экран.
 */
import { useTranslations } from "next-intl";

export function MiniListSkeleton({
  rows = 3,
  label,
}: {
  rows?: number;
  label?: string;
}) {
  const t = useTranslations("errorSurface");
  return (
    <div
      className="flex flex-1 flex-col gap-4 pb-28"
      role="status"
      aria-label={label ?? t("loading")}
      data-testid="mini-list-skeleton"
    >
      <div
        className="mini-skeleton-bar"
        style={{ width: 120, height: 13, borderRadius: 8 }}
      />
      <div className="space-y-2">
        <div
          className="mini-skeleton-bar"
          style={{ width: "65%", height: 22, borderRadius: 11 }}
        />
        <div
          className="mini-skeleton-bar"
          style={{ width: "85%", height: 13, borderRadius: 7 }}
        />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="mini-skeleton-bar"
            style={{ width: "100%", height: 76, borderRadius: 16 }}
          />
        ))}
      </div>
    </div>
  );
}
