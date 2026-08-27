import { connect } from './firestore/client.js';
import { firebaseConfig } from './firebase/config.js';
import { FirestoreBackend } from './firestore/backend.js';
import { MemoryWorld } from './app/memorybackend.js';
import { AppController } from './app/controller.js';
import { roomCodeFromUrl, roomUrl } from './app/roomlink.js';
import { renderApp, type AppActions } from './ui/app.js';
import { renderRecovery } from './ui/recovery.js';
import { renderRoomSetup, controllerModeIsPlaying, type ControllerMode } from './ui/setup.js';
import { detectLang, setLang, t, type Lang } from './ui/i18n.js';
import { DEFAULT_ACTIVE_ROLES, TWO_ROUND_CONFIG } from './engine/presets.js';
import { mayArrangeSeats, reorderForSwap } from './app/seating.js';
import type { Backend } from './app/backend.js';
import type { SeatIndex } from './engine/types.js';

/**
 * The app.
 *
 * This was a demo harness with invented data until now — three surfaces you
 * could look at and argue about, wired to nothing. Everything it rendered is
 * still here; what changed is that the data underneath it is a real room that
 * other people are also in.
 *
 * The shape is deliberately dull: one controller owning the subscriptions
 * (controller.ts), one pure function deciding which screen this device is on
 * (shell.ts), one that decides what it may draw (seats.ts), and one that turns
 * that into elements (ui/app.ts). This file owns only what is genuinely local
 * to one device and one browser tab: which language, what is typed into a
 * field, whether a sheet is open. None of that belongs in a database.
 */

/* ----------------------------- local state ------------------------------ */

interface Local {
  lang: Lang;
  mode: ControllerMode;
  code: string;
  displayName: string;
  error: string | null;
  busy: boolean;
  menuOpen: boolean;
  recovering: boolean;
  recoveryTyped: string;
  shareCopied: boolean;
  /** First tap of a pending seat swap, in the lobby. */
  pendingSwap: SeatIndex | null;
}

const local: Local = {
  lang: detectLang(),
  mode: 'table-device',
  code: roomCodeFromUrl(location.href) ?? '',
  displayName: rememberedName(),
  error: null,
  busy: false,
  menuOpen: false,
  recovering: false,
  recoveryTyped: '',
  shareCopied: false,
  pendingSwap: null,
};

const NAME_KEY = 'dageraad.name';

/** Your name, so a reload does not ask again. Losing it costs nothing (§14). */
function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private browsing. The field just starts empty next time.
  }
}

/* ------------------------------- start-up ------------------------------- */

let controller: AppController;
let backend: Backend;

/**
 * Which backend.
 *
 * `?demo` runs the whole app against the in-memory world, in one tab, with no
 * Firebase project — the same implementation every test uses. It exists so the
 * screens can be walked through offline, and so a broken Firebase config is
 * never the reason nobody can look at the app.
 */
async function makeBackend(): Promise<Backend> {
  if (new URLSearchParams(location.search).has('demo')) {
    return new MemoryWorld(Math.random).device(`demo:${Math.floor(Math.random() * 1e6)}`);
  }
  const connection = await connect(firebaseConfig);
  return new FirestoreBackend(connection.db, connection.uid);
}

async function start(): Promise<void> {
  const app = document.getElementById('app')!;
  try {
    backend = await makeBackend();
  } catch (err) {
    // Anonymous auth disabled in the console is the overwhelmingly likely
    // cause, and it looks like a broken app rather than a missing setting
    // unless somebody says so (SETUP.md §10.3).
    app.replaceChildren(fatal(String(err)));
    return;
  }

  controller = new AppController(backend);
  controller.onChange(() => render());

  // Arriving on a shared link goes straight to joining that room, with the
  // code already filled in. One link in a group chat is the whole
  // distribution story.
  if (local.code) controller.setJoining(true);

  render();
}

function fatal(message: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'join';
  const p = document.createElement('p');
  p.className = 'join__error';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  el.append(p);
  return el;
}

/* -------------------------------- actions ------------------------------- */

/** Run a backend call, showing failures rather than swallowing them. */
async function attempt(fn: () => Promise<void>, onFail?: string): Promise<boolean> {
  local.busy = true;
  local.error = null;
  render();
  try {
    await fn();
    return true;
  } catch (err) {
    local.error = onFail ?? String(err);
    return false;
  } finally {
    local.busy = false;
    render();
  }
}

const actions: AppActions = {
  onModeChange(mode) {
    local.mode = mode;
    render();
  },

  async onCreate(mode) {
    local.mode = mode;
    const name = local.displayName.trim() || defaultName(mode);
    await attempt(async () => {
      const roomId = await backend.createRoom({
        displayName: name,
        activeRoles: DEFAULT_ACTIVE_ROLES,
        config: TWO_ROUND_CONFIG,
        // The single point where the player-facing choice becomes technical:
        // a table device must not be dealt a card, because it can read them
        // all (see ui/setup.ts).
        playing: controllerModeIsPlaying(mode),
      });
      local.code = roomId;
      history.replaceState(null, '', roomUrl(location.href, roomId));
      controller.watch(roomId);
    });
  },

  onCodeChange(code) {
    local.code = code;
    local.error = null;
    render();
  },

  onNameChange(name) {
    local.displayName = name;
    render();
  },

  async onJoin(code, displayName) {
    rememberName(displayName);
    local.displayName = displayName;
    const ok = await attempt(
      () => backend.joinRoom(code, displayName),
      t(local.lang, 'join.noSuchRoom'),
    );
    if (!ok) return;
    history.replaceState(null, '', roomUrl(location.href, code));
    controller.watch(code);
  },

  onBack() {
    controller.reset();
    controller.setJoining(false);
    local.error = null;
    render();
  },

  async onLeave() {
    const roomId = controller.current().roomId;
    if (!roomId) return;
    await attempt(() => backend.leaveRoom(roomId));
  },

  async onRejoin() {
    const roomId = controller.current().roomId;
    if (!roomId) return;
    await attempt(() => backend.joinRoom(roomId, local.displayName || 'Speler'));
  },

  async onDeal() {
    const roomId = controller.current().roomId;
    if (!roomId) return;
    // A fresh seed per round, so two rounds of one evening are not the same
    // deal. The engine's shuffle is seeded so a round stays replayable.
    await attempt(() => backend.startGame(roomId, Math.floor(Math.random() * 1e9)));
  },

  /**
   * Lobby seat swapping: tap one seat, then another.
   *
   * ALL present players may rearrange before a round starts (Milan,
   * 2026-08-26) — at a real table the person who moved chairs is the one who
   * knows, and it is not worth routing that through whoever happens to be
   * host. The order locks the moment play begins, because the Dorpsgek's shift
   * depends on a stable adjacency (§13), and the rules enforce that lock.
   */
  onSeatTap(seat) {
    const state = controller.current();
    const room = state.room;
    // Guarded here as well as in the rules: every present member may arrange,
    // and nobody may once play has begun.
    if (!room || !mayArrangeSeats(room, state.uid)) return;

    if (local.pendingSwap === null) {
      local.pendingSwap = seat;
      render();
      return;
    }
    const first = local.pendingSwap;
    local.pendingSwap = null;
    if (first === seat) {
      render();
      return;
    }

    const order = reorderForSwap(room, state.players, first, seat);

    const roomId = state.roomId;
    if (!roomId) return;
    void attempt(() => backend.setSeating(roomId, order));
  },

  onCardTap() { /* night targeting arrives with the decision prompts */ },
  onNameTap() { /* stats-on-tap arrives with the profile sheet */ },
};

function defaultName(mode: ControllerMode): string {
  return mode === 'table-device' ? 'Tafel' : 'Speler';
}

/* -------------------------------- render -------------------------------- */

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();

  const state = controller.current();
  const screen = controller.screen();

  // Creating a room is the one screen that needs a name before it exists, so
  // it gets its own path rather than being squeezed into renderApp's setup.
  if (screen.kind === 'setup') {
    app.append(nameField(), renderRoomSetup({
      lang: local.lang,
      mode: local.mode,
      canCreate: !local.busy,
      onModeChange: actions.onModeChange,
      onCreate: actions.onCreate,
    }));
    app.append(bottomBar(false));
    if (local.error) app.append(fatal(local.error));
    return;
  }

  app.append(renderApp({
    lang: local.lang,
    state,
    screen,
    mode: local.mode,
    code: local.code,
    displayName: local.displayName,
    error: local.error,
    busy: local.busy,
    selected: local.pendingSwap,
    actions,
  }));

  if (state.roomId) app.append(bottomBar(true));
  if (local.menuOpen) app.append(menu());
  if (local.recovering) app.append(recoverySheet());
}

function nameField(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'join';
  const field = document.createElement('input');
  field.className = 'join__name';
  field.type = 'text';
  field.maxLength = 24;
  field.value = local.displayName;
  field.placeholder = t(local.lang, 'join.namePlaceholder');
  field.setAttribute('aria-label', t(local.lang, 'join.name'));
  field.addEventListener('input', () => {
    local.displayName = field.value;
    rememberName(field.value);
  });
  wrap.append(field);
  return wrap;
}

function bottomBar(inRoom: boolean): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'bottombar';

  if (inRoom) {
    bar.append(button(t(local.lang, 'menu.title'), () => {
      local.menuOpen = true;
      render();
    }));
  }
  bar.append(button(local.lang === 'nl' ? 'EN' : 'NL', () => {
    local.lang = local.lang === 'nl' ? 'en' : 'nl';
    setLang(local.lang);
    render();
  }));
  return bar;
}

/**
 * The menu.
 *
 * Sharing the link and leaving are ordinary. Taking over the game is not, and
 * it sits at the bottom, styled as the exception it is — reachable in two
 * taps, never in one, and never adjacent to anything somebody reaches for
 * casually.
 */
function menu(): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'menu';

  const title = document.createElement('h2');
  title.className = 'setup__title';
  title.textContent = t(local.lang, 'menu.title');
  sheet.append(title);

  const code = controller.current().roomId;
  if (code) {
    const share = button(
      local.shareCopied ? t(local.lang, 'menu.copied') : `${t(local.lang, 'menu.share')} — ${code}`,
      () => {
        void navigator.clipboard?.writeText(roomUrl(location.href, code)).then(() => {
          local.shareCopied = true;
          render();
        }).catch(() => { /* no clipboard permission; the code is on screen */ });
      },
    );
    share.classList.add('menu__item');
    sheet.append(share);
  }

  const leave = button(t(local.lang, 'menu.leave'), () => {
    local.menuOpen = false;
    void actions.onLeave();
  });
  leave.classList.add('menu__item');
  sheet.append(leave);

  const recover = button(t(local.lang, 'menu.recover'), () => {
    local.menuOpen = false;
    local.recovering = true;
    local.recoveryTyped = '';
    local.error = null;
    render();
  });
  recover.classList.add('menu__item', 'menu__item--danger');
  sheet.append(recover);

  const close = button(t(local.lang, 'menu.close'), () => {
    local.menuOpen = false;
    local.shareCopied = false;
    render();
  });
  close.classList.add('menu__item');
  sheet.append(close);

  return sheet;
}

function recoverySheet(): HTMLElement {
  return renderRecovery({
    lang: local.lang,
    typed: local.recoveryTyped,
    error: local.error,
    busy: local.busy,
    onTyped: (value) => {
      local.recoveryTyped = value;
      render();
    },
    onCancel: () => {
      local.recovering = false;
      local.recoveryTyped = '';
      local.error = null;
      render();
    },
    onConfirm: () => {
      const roomId = controller.current().roomId;
      if (!roomId) return;
      void attempt(
        () => backend.takeEmergencyControl(roomId, local.recoveryTyped.trim()),
        t(local.lang, 'recover.failed'),
      ).then((ok) => {
        if (!ok) return;
        local.recovering = false;
        local.recoveryTyped = '';
        render();
      });
    },
  });
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

void start();
