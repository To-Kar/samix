// Colour maths for the contrast gate: WCAG 2 contrast ratio plus OKLab/OKLCH
// conversion, so a user colour can be corrected by moving lightness only
// (hue and chroma stay what the user picked).

type Rgb = [number, number, number];
type Oklab = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : null;
}

function toHex(rgb: Rgb): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** "246 241 230" — the form Tailwind's `rgb(var(--x) / <alpha-value>)` needs. */
export function hexToTriplet(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`invalid colour ${hex}`);
  return rgb.join(' ');
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`invalid colour ${hex}`);
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 … 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function hexToOklab(hex: string): Oklab {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`invalid colour ${hex}`);
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, A, B]: Oklab): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab → hex; reduces chroma until the colour fits sRGB. */
function oklabToHex([L, A, B]: Oklab): string {
  const chroma = Math.hypot(A, B);
  const hue = Math.atan2(B, A);
  for (let c = chroma; c >= 0; c -= 0.005) {
    const rgb = oklabToLinearRgb([L, c * Math.cos(hue), c * Math.sin(hue)]);
    if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
      return toHex(rgb.map((v) => Math.min(1, Math.max(0, toGamma(Math.max(0, v)))) * 255) as Rgb);
    }
  }
  return toHex(oklabToLinearRgb([L, 0, 0]).map((v) => toGamma(Math.min(1, Math.max(0, v))) * 255) as Rgb);
}

/** Black or white, whichever reads better on `hex`. */
export function bestOn(hex: string): string {
  return contrast('#000000', hex) >= contrast('#ffffff', hex) ? '#000000' : '#ffffff';
}

const isDarkGround = (hex: string) => contrast(hex, '#ffffff') > contrast(hex, '#000000');

/**
 * Moves the OKLCH lightness of `hex` (towards white on dark grounds, towards
 * black on light ones) until `ok` holds. Always terminates with a result:
 * pure black/white is the limit, which clears 7:1 on every built-in ground.
 */
export function fitLightness(hex: string, grounds: string[], ok: (candidate: string) => boolean): string {
  if (ok(hex)) return hex;
  const [L, A, B] = hexToOklab(hex);
  const lighten = grounds.every(isDarkGround);
  for (let i = 1; i <= 100; i++) {
    const candidate = oklabToHex([lighten ? Math.min(1, L + i * 0.01) : Math.max(0, L - i * 0.01), A, B]);
    if (ok(candidate)) return candidate;
  }
  return lighten ? '#ffffff' : '#000000';
}

const WARM_HUE = (70 * Math.PI) / 180;
const COOL_HUE = (230 * Math.PI) / 180;
const MAX_TONE_CHROMA = 0.03;

/**
 * Paper tone: pushes a surface colour towards warm (step < 0) or cool
 * (step > 0) at fixed OKLab lightness. Chroma stays ≤ 0.03 unless the theme
 * itself already uses more.
 */
export function shiftTone(hex: string, step: number): string {
  if (step === 0) return hex;
  const [L, A, B] = hexToOklab(hex);
  const hue = step < 0 ? WARM_HUE : COOL_HUE;
  const amount = 0.006 * Math.abs(step);
  let a = A + amount * Math.cos(hue);
  let b = B + amount * Math.sin(hue);
  const limit = Math.max(MAX_TONE_CHROMA, Math.hypot(A, B));
  const c = Math.hypot(a, b);
  if (c > limit) {
    a *= limit / c;
    b *= limit / c;
  }
  return oklabToHex([L, a, b]);
}
