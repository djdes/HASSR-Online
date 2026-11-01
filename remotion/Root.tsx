import "./style.css";

import { Composition } from "remotion";

import { AUTOFILL_CLIP, AUTOFILL_CLIP_SCENES, AUTOFILL_FPS } from "@/lib/autofill-offer";

import { AUTOFILL_VIDEO_CONFIG, AutofillClip, AutofillTour } from "./autofill-tour";
import { QrTourNarrated, TIMELINE, VIDEO, type QrTourProps } from "./tour";

/**
 * Композиции видео для главной. `QrTourNarrated` — ролик «Как работает
 * QR» с голосом, 1920×1080, 30 fps. Пропсы (QR и «сегодня» для бланков)
 * передаёт скрипт рендера; значения по умолчанию — для студии.
 */
const DEFAULT_PROPS: QrTourProps = {
  qr: { bare: '<svg xmlns="http://www.w3.org/2000/svg"/>', printed: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  today: { day: 17, month: 10, year: 2026, daysInMonth: 31, monthLabel: "октябрь 2026" },
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="QrTourNarrated"
      component={QrTourNarrated}
      durationInFrames={TIMELINE.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
      defaultProps={DEFAULT_PROPS}
    />
    {/* «Журналы, которые заполняются сами» для /avtozapolnenie — без голоса. */}
    <Composition id="AutofillTour" component={AutofillTour} {...AUTOFILL_VIDEO_CONFIG} />
    {/* Вертикальные ролики 1080×1920 по 15 с для соцсетей — по сцене на источник. */}
    {AUTOFILL_CLIP_SCENES.map((sceneId) => (
      <Composition
        key={sceneId}
        id={`AutofillClip-${sceneId}`}
        component={AutofillClip}
        fps={AUTOFILL_FPS}
        width={AUTOFILL_CLIP.width}
        height={AUTOFILL_CLIP.height}
        durationInFrames={AUTOFILL_CLIP.durationInFrames}
        defaultProps={{ sceneId }}
      />
    ))}
  </>
);
