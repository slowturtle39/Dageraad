/**
 * The sheet — everything that isn't the table.
 *
 * Prompts, stats and results all appear as a sheet drawn OVER the seating
 * circle, never instead of it (§13.1). The table stays visible behind, so from
 * across the room a player being asked to make a decision looks the same as a
 * player idly reading somebody's stats.
 *
 * The scrim is deliberately mild for the same reason: a heavy blackout would
 * change how much light the phone throws.
 */

export interface SheetOptions {
  title: string;
  subtitle?: string;
  body?: HTMLElement;
  actions?: { label: string; primary?: boolean; onSelect: () => void }[];
  note?: string;
  onDismiss?: () => void;
  /** A prompt with a deadline can't be dismissed by tapping away. */
  dismissable?: boolean;
  /** A lightweight control panel that should not eclipse the table. */
  variant?: 'vote';
}

export function renderSheet(opts: SheetOptions): HTMLElement {
  const wrap = document.createElement('div');

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  if (opts.dismissable !== false) {
    scrim.addEventListener('click', () => opts.onDismiss?.());
  }

  const sheet = document.createElement('div');
  sheet.className = opts.variant ? `sheet sheet--${opts.variant}` : 'sheet';

  const grip = document.createElement('div');
  grip.className = 'sheet__grip';
  sheet.append(grip);

  const title = document.createElement('h2');
  title.className = 'sheet__title';
  title.textContent = opts.title;
  sheet.append(title);

  if (opts.subtitle) {
    const sub = document.createElement('p');
    sub.className = 'sheet__sub';
    sub.textContent = opts.subtitle;
    sheet.append(sub);
  }

  if (opts.body) sheet.append(opts.body);

  for (const action of opts.actions ?? []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = action.primary ? 'btn btn--primary' : 'btn';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onSelect);
    sheet.append(btn);
  }

  if (opts.note) {
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = opts.note;
    sheet.append(note);
  }

  wrap.append(scrim, sheet);
  return wrap;
}

/**
 * Format a private reveal for display.
 *
 * ALWAYS phrased in the past tense, tagged to the viewer's own turn. What the
 * Mystieke Wolf saw at step 4 may have been moved by the Dorpsgek at step 8, so
 * rendering it as a present fact ("seat 3 is the Ziener") would actively
 * mislead in exactly the games where somebody did something interesting.
 */
export function describeReveal(
  info: { kind: string; [k: string]: unknown },
  seatName: (seat: number) => string,
  roleName: (role: string) => string,
): string {
  switch (info.kind) {
    case 'saw-card':
      return `Bij jouw beurt had ${seatName(info.slot as number)} de ${roleName(
        info.role as string,
      )}.`;
    case 'saw-center':
      return `Bij jouw beurt lag de ${roleName(info.role as string)} op middenkaart ${
        (info.centerIndex as number) + 1
      }.`;
    case 'saw-wolves': {
      const seats = info.seats as number[];
      if (seats.length === 0) return 'Je zag geen andere wolven.';
      return `Bij jouw beurt waren de andere wolven: ${seats.map(seatName).join(', ')}.`;
    }
    case 'saw-masons': {
      const seats = info.seats as number[];
      return seats.length === 0
        ? 'Je bent de enige Vrijmetselaar.'
        : `Je medevrijmetselaars: ${seats.map(seatName).join(', ')}.`;
    }
    case 'copied-role':
      return `Je kopieerde ${seatName(info.fromSeat as number)}: de ${roleName(
        info.role as string,
      )}.`;
    case 'became-role':
      return `Je bent nu zelf de ${roleName(info.role as string)}.`;
    case 'judged':
      return 'De Rechter heeft jou gekozen. Je eerste uitspraak vandaag moet waar zijn.';
    case 'card-locked':
      return 'Jouw kaart kan deze nacht niet worden verplaatst.';
    case 'own-final-card':
      return `Je eindigt de nacht als de ${roleName(info.role as string)}.`;
    case 'action-confirmed':
      return `Uitgevoerd: ${info.detail as string}.`;
    case 'action-blocked':
      return info.reason === 'shielded'
        ? 'Die kaart was beschermd door de Schildwacht. Er is niets gebeurd.'
        : 'Er was geen geldig doelwit.';
    case 'no-action':
      return 'Je hebt deze nacht niets gedaan.';
    default:
      return '';
  }
}
