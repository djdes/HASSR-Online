// Shared by scripts/gen-borderless.mjs and src/app/borderless.test.ts (no side effects on import).

/**
 * A structural outline, not a status or accent colour: light, and either almost
 * without colour, a muted cool blue-grey (the palette's own greys, `#dcdfed`,
 * `#ececf4`, …) or a very pale indigo tint. Greens, reds and ambers of the same
 * lightness are status; the brand `#5566f6` and dark outlines are accents.
 */
export function isNeutralBorder(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (lightness < 0.78) return false;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  if (saturation <= 0.2) return true;
  const delta = max - min;
  const hue = 60 * (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
  if (hue < 210 || hue > 255) return false;
  // A pale indigo outline (`#dfe3ff`, `#dfe3fb`) sits on a box of the same tint: the fill says it all.
  return saturation <= 0.46 || lightness >= 0.9;
}
