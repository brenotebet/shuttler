export const PRIMARY_COLOR = '#16a34a';   // green-700 — readable on white
export const PRIMARY_LIGHT = '#4ADE80';   // lime accent for backgrounds/badges
export const BACKGROUND_COLOR = '#FFFFFF';
export const CARD_BACKGROUND = '#F8FAFC';
export const SURFACE_COLOR = '#F1F5F9';
export const TEXT_PRIMARY = '#0F172A';
export const TEXT_SECONDARY = '#64748B';
// Realigned from #ef4444 to #dc2626 — the shade that was already hardcoded
// at every actual "danger" call site (delete/remove buttons, error text)
// while this token itself sat mostly unused. Same value, one name now.
export const DANGER_COLOR = '#dc2626';

export const WHITE = '#FFFFFF';
export const BLACK = '#000000';

// Neutral gray scale (Tailwind's "gray", distinct from the slate-based
// TEXT_SECONDARY/SURFACE_COLOR above) — this is the scale that was actually
// being retyped ad hoc across dozens of screens. Naming the values already
// in use doesn't change how anything looks, it just gives them one source.
export const GRAY_50 = '#f9fafb';
export const GRAY_100 = '#f3f4f6';
export const GRAY_200 = '#e5e7eb';
export const GRAY_300 = '#d1d5db';
export const GRAY_400 = '#9ca3af';
export const GRAY_500 = '#6b7280';
export const GRAY_600 = '#4b5563';
export const GRAY_700 = '#374151';
export const GRAY_800 = '#1f2937';
export const GRAY_900 = '#111827';

// Slate-scale border color — already the de facto standard for tab-bar and
// header dividers across the app; naming it stops it being retyped ad hoc.
export const BORDER_COLOR = '#E2E8F0';
