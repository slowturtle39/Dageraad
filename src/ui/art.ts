import type { RoleId } from '../engine/types.js';

/**
 * Role emblems.
 *
 * THESE ARE PLACEHOLDERS, drawn from scratch for this app. They are NOT the
 * printed game's artwork — that belongs to its publisher and is not ours to
 * copy. §13 already assumed Milan would crop the rulebook icons himself for a
 * personal, non-commercial app; this exists so that when he does, the swap is a
 * file drop rather than a code change.
 *
 * HOW TO REPLACE ONE: put an image at `public/roles/<roleId>.png` (or .svg,
 * .webp) and it wins automatically — see `roleArt` below. Nothing here needs
 * editing, and any role without a file keeps its placeholder, so the set can be
 * replaced a few at a time rather than all at once.
 *
 * Style notes for anything drawn later: single-weight line art on a 24×24 grid,
 * `currentColor` only, no fills. That keeps one emblem legible at 22px on a
 * phone card and at 50px on the tablet, and lets the same file serve the bone
 * card face (dark ink) and a dashed suspicion guess (dim gold) without a second
 * asset.
 */

const S = 'stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

/** Wolf head — the base shape the four wolf roles vary. */
const WOLF = `<path ${S} d="M3.5 8.5 5.5 2.5 9.5 6"/><path ${S} d="M20.5 8.5 18.5 2.5 14.5 6"/><path ${S} d="M3.5 8.5c0 7 3.8 12.5 8.5 12.5s8.5-5.5 8.5-12.5"/><path ${S} d="M9.5 11h.01M14.5 11h.01"/><path ${S} d="M12 14.5 10.5 16.5h3z"/>`;

const EYE = `<path ${S} d="M2 12s3.6-5.5 10-5.5S22 12 22 12s-3.6 5.5-10 5.5S2 12 2 12z"/><circle ${S} cx="12" cy="12" r="2.4"/>`;

const ART: Partial<Record<RoleId, string>> = {
  weerwolf: WOLF,

  // Wolf variants: the same head, marked. A player should be able to tell them
  // apart at a glance without reading, but still see "wolf" first.
  droomwolf: `${WOLF}<path ${S} d="M19.5 17.5a3.2 3.2 0 1 1-3-4.4 2.6 2.6 0 0 0 3 4.4z"/>`,
  alphawolf: `${WOLF}<path ${S} d="M8 4.2 9.8 6 12 3.4 14.2 6 16 4.2"/>`,
  mystiekewolf: `${WOLF}<circle ${S} cx="12" cy="9.6" r="2"/><path ${S} d="M12 8.4v2.4"/>`,
  volgeling: `<path ${S} d="M12 20c-3 0-5-1.8-5-4 0-1.9 2-3.2 5-3.2s5 1.3 5 3.2c0 2.2-2 4-5 4z"/><circle ${S} cx="6.2" cy="9" r="2"/><circle ${S} cx="17.8" cy="9" r="2"/><circle ${S} cx="9.6" cy="5" r="2"/><circle ${S} cx="14.4" cy="5" r="2"/>`,

  ziener: EYE,
  leerlingziener: `${EYE}<path ${S} d="M12 2.5v1.8M4.6 4.6l1.3 1.3M19.4 4.6l-1.3 1.3"/>`,
  slapeloze: `${EYE}<path ${S} d="M20.5 5.5a2.6 2.6 0 1 1-2.4-3.5 2.1 2.1 0 0 0 2.4 3.5z"/>`,
  schoneslaapster: `<path ${S} d="M3 12.5c3 3 15 3 18 0"/><path ${S} d="M6.5 10.5 5 8.8M12 9.6V7.4M17.5 10.5 19 8.8"/><path ${S} d="M9 18.5c1-1.6 5-1.6 6 0"/>`,

  // Witch: hat and cauldron, the two things that read fastest at this size.
  heks: `<path ${S} d="M4.5 15.5h15"/><path ${S} d="M6.5 15.5 12 3l5.5 12.5"/><path ${S} d="M9.2 10.6h5.6"/><path ${S} d="M7 18h10l-1 3H8z"/>`,

  medium: `<circle ${S} cx="12" cy="10" r="5.5"/><path ${S} d="M7 18.5h10l-1.4 2.5H8.4z"/><path ${S} d="M9.8 9.2a2.6 2.6 0 0 1 2.6-2.2"/>`,

  dorpsgek: `<path ${S} d="M5 13c0-4 3.1-7 7-7s7 3 7 7"/><path ${S} d="M5 13 3 8.4l3.4 1.5M19 13l2-4.6-3.4 1.5M12 6V3"/><circle ${S} cx="12" cy="2.6" r="1"/><path ${S} d="M4.6 13.5h14.8l-1.2 6.9H5.8z"/>`,

  dubbelganger: `<circle ${S} cx="9" cy="8" r="3.4"/><path ${S} d="M3.4 19.5c0-3 2.5-5 5.6-5s5.6 2 5.6 5"/><circle ${S} cx="16.4" cy="8" r="3.4" stroke-dasharray="2 2"/><path ${S} d="M10.8 19.5c0-3 2.5-5 5.6-5 2 0 3.8.8 4.8 2.2" stroke-dasharray="2 2"/>`,

  schildwacht: `<path ${S} d="M12 2.5 20 5.5v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10v-6z"/><path ${S} d="M8.6 11.8h6.8"/><path ${S} d="M12 8.6v6.4"/>`,
  bodyguard: `<path ${S} d="M12 2.5 20 5.5v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10v-6z"/><path ${S} d="M8.8 12.2 11 14.4l4.4-4.6"/>`,

  jager: `<path ${S} d="M5 19 19 5"/><path ${S} d="M14 5h5v5"/><path ${S} d="M6.5 4.5c6 1 9 4 10 10"/><path ${S} d="M6.5 4.5 4.5 6.5"/>`,

  dorpeling: `<path ${S} d="M4 11 12 4.5 20 11"/><path ${S} d="M6 10v9.5h12V10"/><path ${S} d="M10.2 19.5v-5h3.6v5"/>`,

  // Tanner: a hide stretched on a frame. Odd-looking on purpose — this role
  // wants to be memorable rather than pretty.
  looier: `<path ${S} d="M8 3.5 6 8l-2.2 1.4L6 12l-1 4.4 3.6-1.2L12 20.5l3.4-5.3 3.6 1.2-1-4.4 2.2-2.6L18 8l-2-4.5-4 2z"/>`,

  rechter: `<path ${S} d="M12 3.5v17"/><path ${S} d="M5 7h14"/><path ${S} d="M5 7 2.8 12.4h4.4zM19 7l-2.2 5.4h4.4z"/><path ${S} d="M8 20.5h8"/>`,

  onderzoeker: `<circle ${S} cx="10.4" cy="10.4" r="6"/><path ${S} d="M14.8 14.8 20.5 20.5"/><path ${S} d="M7.8 10.4a2.6 2.6 0 0 1 2.6-2.6"/>`,

  onrustoker: `<path ${S} d="M3.5 8.5h13"/><path ${S} d="M13.5 5.2 16.8 8.5l-3.3 3.3"/><path ${S} d="M20.5 15.5h-13"/><path ${S} d="M10.5 12.2 7.2 15.5l3.3 3.3"/>`,

  dronkaard: `<path ${S} d="M6 6.5h9v13H6z"/><path ${S} d="M15 9h2.8a2.2 2.2 0 0 1 0 4.4H15"/><path ${S} d="M6 10.5h9"/><path ${S} d="M8.5 3.5v2M11.5 2.8v2.7"/>`,

  vrijmetselaar: `<path ${S} d="M12 3.2 5 15.5h14z"/><path ${S} d="M8.4 15.5 12 9.4l3.6 6.1"/><path ${S} d="M4 18.5h16"/>`,
};

const IMAGE_BASE = '/roles/';

/** Roles that have a drop-in image file. Populated by `registerRoleImages`. */
const overrides = new Set<RoleId>();

/**
 * Declare which roles have a real image in `public/roles/`.
 *
 * Called once at startup with whatever is actually present. Kept explicit
 * rather than probing for files, because a missing image would otherwise show
 * as a broken-image icon on somebody's card mid-game — a placeholder emblem is
 * a far better failure than that.
 */
export function registerRoleImages(roles: Iterable<RoleId>): void {
  overrides.clear();
  for (const r of roles) overrides.add(r);
}

export function hasArt(role: RoleId): boolean {
  return overrides.has(role) || ART[role] !== undefined;
}

/**
 * An emblem for a role, sized to its container and inheriting `currentColor`.
 *
 * Returns null when there is nothing to draw, so callers fall back to the role
 * name — which is always legible, and is what every card showed before any of
 * this existed.
 */
export function roleArt(role: RoleId): HTMLElement | SVGElement | null {
  if (overrides.has(role)) {
    const img = document.createElement('img');
    img.className = 'emblem';
    img.src = `${IMAGE_BASE}${role}.png`;
    img.alt = '';
    return img;
  }

  const paths = ART[role];
  if (!paths) return null;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'emblem');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}
