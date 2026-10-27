/** Все иллюстрации плакатов по имени. Правила рисования — `types.ts`. */

import { HAND_ART } from "./hands";
import { KITCHEN_ART } from "./kitchen";
import { MISC_ART } from "./misc";
import type { PosterArtComponent, PosterArtName, PosterArtProps } from "./types";

export * from "./types";

export const POSTER_ART: Record<PosterArtName, PosterArtComponent> = {
  ...HAND_ART,
  ...KITCHEN_ART,
  ...MISC_ART,
};

export function PosterArt({ name, ...props }: PosterArtProps & { name: PosterArtName }) {
  const Art = POSTER_ART[name];
  return <Art {...props} />;
}
