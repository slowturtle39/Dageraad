import { connect } from './firestore/client.js';
import { firebaseConfig } from './firebase/config.js';
import { FirestoreBackend } from './firestore/backend.js';
import { botSeatsFor, demoTable, seatDemoBots, type DemoTable } from './app/demoworld.js';
import { AppController } from './app/controller.js';
import { homeUrl, roomCodeFromUrl, roomUrl } from './app/roomlink.js';
import { renderApp, type AppActions } from './ui/app.js';
import { renderRecovery } from './ui/recovery.js';
import {
  renderAllTime, renderFriendPicker, renderModePicker, renderRoomStatusBadge,
} from './ui/alltime.js';
import { allTimeStandings, type HistoryRecord } from './stats/alltime.js';
import {
  rememberFriendId, rememberedFriendId, type FriendProfile,
} from './app/friend.js';
import {
  renderDiscussionTimer, renderRoomSetup, renderResolutionPicker,
  controllerModeIsPlaying, type ControllerMode,
} from './ui/setup.js';
import {
  nextPendingRequest, renderPrompt, seatSelectable, toggleCenterPick,
} from './ui/prompt.js';
import { describeReveal, renderSheet } from './ui/sheet.js';
import { renderVoting } from './ui/voting.js';
import { runGame } from './app/refereeRunner.js';
import { detectLang, roleName, setLang, t, type Lang } from './ui/i18n.js';
import {
  DEFAULT_ACTIVE_ROLES, DEPENDENCY_CONFIG, TWO_ROUND_CONFIG,
} from './engine/presets.js';
import { mayArrangeSeats, reorderForSwap } from './app/seating.js';
import { canDeal } from './app/shell.js';
import {
  MAX_DISCUSSION_MS, MIN_DISCUSSION_MS, type Backend, type RoomMode,
} from './app/backend.js';
import type { Choice, ResolutionMode, RoleId, SeatIndex } from './engine/types.js';

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
  /** Seats picked for the night prompt currently open. */
  picked: SeatIndex[];
  pickedCenters: number[];
  /** Day phase: who this device is voting for, and whether it is abstaining. */
  voteTarget: SeatIndex | null;
  abstaining: boolean;
  /** "Let us vote now." A decision about the clock, not the outcome. */
  readyToVote: boolean;
  /** Private result messages acknowledged in the current round. */
  acknowledgedPrivateInfo: number;
  privateInfoRound: number | null;
  /** True once this device has run the round it is refereeing. */
  refereeRunning: boolean;
  /** Which human this device is, across evenings. Null until picked. */
  friend: FriendProfile | null;
  friends: FriendProfile[];
  friendTyped: string;
  /** Whether the room this device is about to create will count. */
  roomMode: RoomMode;
  resolutionMode: ResolutionMode;
  discussionMinutes: string;
  history: HistoryRecord[];
  showAllTime: boolean;
  showProfiles: boolean;
  /** Answers submitted locally in the currently open night window. */
  submittedDecisionKeys: string[];
  decisionWindow: string | null;
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
  picked: [],
  pickedCenters: [],
  voteTarget: null,
  abstaining: false,
  readyToVote: false,
  acknowledgedPrivateInfo: 0,
  privateInfoRound: null,
  refereeRunning: false,
  friend: null,
  friends: [],
  friendTyped: '',
  // Practice unless somebody deliberately says otherwise. A test evening in
  // append-only history cannot be taken back out.
  roomMode: 'practice',
  resolutionMode: 'tworound',
  discussionMinutes: '15',
  history: [],
  showAllTime: false,
  showProfiles: false,
  submittedDecisionKeys: [],
  decisionWindow: null,
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
let demo: DemoTable | null = null;

/** True when the URL asks for a walkthrough rather than a real evening. */
function isFast(): boolean {
  return new URLSearchParams(location.search).has('fast');
}

/**
 * Which resolution mode a new room uses.
 *
 * `?mode=dependency` picks the longer variant where everyone acts live and
 * waits for each other; the default is the two-round one the group plays. A
 * URL flag rather than a setup screen for now — the host picking this is a
 * real feature and this is the walkthrough hook for it.
 */
function configFromSetup() {
  return local.resolutionMode === 'dependency' ? DEPENDENCY_CONFIG : TWO_ROUND_CONFIG;
}

/**
 * The deal seed, when one was asked for.
 *
 * `?seed=N` makes a round reproducible, which is what lets a specific
 * situation be walked through deliberately rather than waited for. The engine
 * shuffle has always been seeded; this just stops the seed being random.
 */
function seedFromUrl(): number {
  const asked = new URLSearchParams(location.search).get('seed');
  const parsed = asked === null ? Number.NaN : Number(asked);
  return Number.isFinite(parsed) ? parsed : Math.floor(Math.random() * 1e9);
}

/**
 * `?fast` shortens the whole round so the flow can be walked in seconds.
 *
 * BOTH halves, which is the bit that is easy to get wrong: shortening only the
 * night leaves a fifteen-minute discussion and a ten-minute vote wait, so the
 * round appears to hang somewhere after the last window. A real evening uses
 * the real numbers — a night window is as long as it is because people need
 * that long to decide (§5.3), and the discussion is the game.
 */
function fastDurations(): { openWindowMs: number; resolvePadMs: number;
  followupMs: Record<string, number>; defaultFollowupMs: number } | undefined {
  if (!isFast()) return undefined;
  return { openWindowMs: 400, resolvePadMs: 100, followupMs: {}, defaultFollowupMs: 400 };
}

function fastDayConfig(): { discussionMs: number; voteWaitTimeoutMs: number;
  abstainPollMs: number } | undefined {
  if (!isFast()) return undefined;
  return { discussionMs: 800, voteWaitTimeoutMs: 4_000, abstainPollMs: 100 };
}

async function makeBackend(): Promise<Backend> {
  if (new URLSearchParams(location.search).has('demo')) {
    demo = demoTable(Math.random);
    // A solo walk-through needs this browser to receive a seat alongside the
    // bots. The normal table-device default would create only a neutral board.
    local.mode = 'trusted-host';
    return demo.me;
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
  window.setInterval(refreshDiscussionTimer, 250);

  // The group, rather than one evening: both span every room, so both are
  // watched for as long as the app is open.
  backend.watchFriends((friends) => {
    local.friends = friends;
    const remembered = rememberedFriendId();
    if (!local.friend && remembered) {
      local.friend = friends.find((f) => f.id === remembered) ?? null;
    }
    render();
  });
  backend.watchHistory((history) => {
    local.history = history;
    render();
  });

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
    const discussionMs = discussionMsFromInput(local.discussionMinutes);
    if (discussionMs === null) {
      local.error = t(local.lang, 'timer.invalid');
      render();
      return;
    }
    local.mode = mode;
    const name = local.displayName.trim() || defaultName(mode);
    await attempt(async () => {
      const roomId = await backend.createRoom({
        displayName: name,
        activeRoles: DEFAULT_ACTIVE_ROLES,
        config: configFromSetup(),
        // The single point where the player-facing choice becomes technical:
        // a table device must not be dealt a card, because it can read them
        // all (see ui/setup.ts).
        playing: controllerModeIsPlaying(mode),
        mode: local.roomMode,
        discussionMs,
        ...(local.friend
          ? { friend: { friendId: local.friend.id, friendName: local.friend.displayName } }
          : {}),
      });
      local.code = roomId;
      // In demo mode the rest of the table sits down immediately, so one tab
      // has enough people to deal a round.
      if (demo) await seatDemoBots(demo, roomId);
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
      () => backend.joinRoom(code, displayName, local.friend
        ? { friendId: local.friend.id, friendName: local.friend.displayName }
        : undefined),
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

  /**
   * Deal, then actually run the round.
   *
   * Two calls rather than one, and the split matters: the deal is a single
   * write that either happened or did not, and `runGame` is a long loop that
   * sleeps out every window. Only the referee device does either — the button
   * is not rendered anywhere else, and both the backend and the rules refuse
   * it regardless.
   */
  async onDeal() {
    const roomId = controller.current().roomId;
    if (!roomId || local.refereeRunning) return;
    // A fresh seed per round, so two rounds of one evening are not the same
    // deal. The engine's shuffle is seeded so a round stays replayable.
    const dealt = await attempt(() => backend.startGame(roomId, seedFromUrl()));
    if (!dealt) return;

    local.refereeRunning = true;
    render();
    try {
      // Everything after this — windows, reveals, the vote, publishing the
      // result and recording the round — is the existing referee path. This
      // file does not reimplement any of it; it presses start and follows
      // along through onPhase so the tablet redraws as the night moves.
      const room = controller.current().room;
      const durations = fastDurations();
      const dayConfig = fastDayConfig();
      await runGame({
        backend,
        roomId,
        onPhase: () => render(),
        onWindowOpen: () => render(),
        ...(durations ? { durations } : {}),
        ...(dayConfig ? { dayConfig } : {}),
        // Demo only. In a real room every seat is a person, and a bot seat
        // would be the referee answering on somebody's behalf.
        ...(demo && room
          ? { bots: botSeatsFor(demo, room.seating, Math.floor(Math.random() * 1e6)) }
          : {}),
      });
    } catch (err) {
      local.error = String(err);
    } finally {
      local.refereeRunning = false;
      render();
    }
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
    if (!room || (!mayArrangeSeats(room, state.uid) && room.refereeUid !== state.uid)) return;

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

  /**
   * Tapping a card.
   *
   * During a night prompt this is picking a target, and that has to win over
   * everything else — a player with a question open is answering it. Outside a
   * prompt, the day phase uses the same gesture to choose who to vote for.
   */
  onCardTap(seat) {
    const state = controller.current();
    const request = firstPending();

    if (request && seatSelectable(request, seat)) {
      if (request.prompt.kind === 'seat-or-center') local.pickedCenters = [];
      const already = local.picked.indexOf(seat);
      if (already >= 0) local.picked.splice(already, 1);
      else if (request.prompt.kind === 'two-seats') {
        // Two seats and no more: a third tap replaces the older pick rather
        // than silently doing nothing, which reads as a broken screen.
        local.picked = [...local.picked, seat].slice(-2);
      } else {
        local.picked = [seat];
      }
      render();
      return;
    }

    const room = state.room;
    if (!room) return;
    if (room.phase === 'voting' || room.phase === 'day') {
      // §7: never yourself. The rules reject it too, but a screen that lets
      // you tap it and then fails is a screen that lied.
      const ownSeat = room.seating.indexOf(state.uid);
      if (seat === ownSeat) return;
      local.voteTarget = local.voteTarget === seat ? null : seat;
      render();
    }
  },

  onNameTap() { /* stats-on-tap arrives with the profile sheet */ },

  /**
   * Add one AI player to a practice lobby.
   *
   * One tap, one bot, so a table can be any mix of people and machines. The
   * button is only rendered on the browser that resolves the room, in a
   * practice lobby, and every one of those conditions is re-checked by the
   * backend and again by the security rules — this handler is the convenience,
   * not the protection.
   */
  onAddBot() {
    const roomId = controller.current().roomId;
    if (!roomId) return;
    void attempt(() => backend.addBot(roomId));
  },

  onRemoveBot(uid: string) {
    const roomId = controller.current().roomId;
    if (!roomId) return;
    void attempt(() => backend.removeBot(roomId, uid));
  },

  onRolesChange(roles: RoleId[]) {
    const state = controller.current();
    if (!state.roomId || !state.room) return;
    void attempt(() => backend.setActiveRoles(state.roomId!, roles, state.room!.config));
  },
};

/** Return this browser to the start screen without removing it from the room. */
function returnHome(): void {
  controller.reset();
  local.code = '';
  local.menuOpen = false;
    local.showAllTime = false;
    local.showProfiles = false;
  local.recovering = false;
  local.error = null;
  history.replaceState(null, '', homeUrl(location.href));
  render();
}

/**
 * Open a practice room this browser plays in and controls.
 *
 * This replaces a button that said "play solo with 7 AI players" and meant it
 * literally: seven bots, no way to seat a friend beside them, and a night
 * window of 400ms because the same flag that summoned the bots also
 * fast-forwarded the clock. Four hundred milliseconds is not a decision, it is
 * a flicker — which is why the Doppelganger's copied-role prompt was never
 * answerable by the person holding the phone.
 *
 * So: a real room, in practice mode, at the timings a person can actually use.
 * The AI players are added one at a time in the lobby, beside however many
 * friends are in the room. Nothing about this path is a special mode — it is
 * the ordinary room, opened with the two choices already made.
 */
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
  const pendingPrompt = firstPending();

  // Creating a room is the one screen that needs a name before it exists, so
  // it gets its own path rather than being squeezed into renderApp's setup.
  if (screen.kind === 'setup') {
    // Who you are comes first. Everything after it is about this evening; this
    // is the one question whose answer outlives it.
    if (!local.friend && !demo) {
      app.append(friendPicker());
      app.append(joinExistingButton());
      app.append(bottomBar(false));
      if (local.error) app.append(fatal(local.error));
      return;
    }

    app.append(renderModePicker({
      lang: local.lang,
      mode: local.roomMode,
      onModeChange: (mode) => {
        local.roomMode = mode;
        render();
      },
    }));
    app.append(renderResolutionPicker({
      lang: local.lang,
      mode: local.resolutionMode,
      onModeChange: (mode) => {
        local.resolutionMode = mode;
        render();
      },
    }));
    app.append(renderDiscussionTimer({
      lang: local.lang,
      minutes: local.discussionMinutes,
      onMinutesChange: (minutes) => {
        local.discussionMinutes = minutes;
        local.error = null;
      },
    }));
    app.append(nameField(), renderRoomSetup({
      lang: local.lang,
      mode: local.mode,
      canCreate: !local.busy,
      onModeChange: actions.onModeChange,
      onCreate: actions.onCreate,
    }));
    app.append(joinExistingButton());
    app.append(bottomBar(false));
    if (local.error) app.append(fatal(local.error));
    return;
  }

  // A shared-link visitor chooses who they are before joining. Without this,
  // joining from the link skipped the profile picker entirely and the round
  // could never be attributed to the friend in all-time history.
  if (screen.kind === 'join' && !local.friend && !demo) {
    app.append(friendPicker(), bottomBar(false));
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
    // The table stays interactive underneath a decision sheet. Reflect the
    // first live card pick there, otherwise a successful tap looks ignored.
    selected: pendingPrompt && local.picked.length === 1
      ? local.picked[0]
      : local.pendingSwap,
    prompting: pendingPrompt !== undefined,
    legalTargetSeats: pendingPrompt
      ? state.room?.seating
        .map((_, seat) => seat as SeatIndex)
        .filter((seat) => seatSelectable(pendingPrompt, seat))
      : undefined,
    timer: state.room ? discussionTimerText(state.room) : null,
    actions,
  }));

  // A practice evening says so the whole time it is being played, not
  // afterwards. Above everything, so it is not something you scroll to.
  if (state.room) {
    const practiceVote = practiceVoteShortcut();
    if (practiceVote) app.prepend(practiceVote);
    app.prepend(renderRoomStatusBadge(local.lang, state.room.mode, state.room.config.mode));
    app.prepend(gameProgress());
  }

  if (state.roomId) app.append(bottomBar(true));
  if (local.showAllTime) app.append(allTimeSheet());
  if (local.showProfiles) app.append(profileSheet());

  // Drawn OVER the table, never instead of it (§13.1): from across the room,
  // deciding and idly browsing have to look the same.
  const overlay = tableOverlay();
  if (overlay) app.append(overlay);

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
 * A public heartbeat for every device. It deliberately says only which shared
 * stage is open and how many public night windows exist, never who is acting
 * or whether somebody has already answered.
 */
function gameProgress(): HTMLElement {
  const room = controller.current().room!;
  const el = document.createElement('div');
  el.className = 'gameprogress';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  if (room.phase === 'night') {
    const total = room.timeline?.phases.length ?? 1;
    el.textContent = local.lang === 'nl'
      ? `Nacht bezig · stap ${Math.min(room.nightWindowIndex + 1, total)} van ${total}`
      : `Night in progress · step ${Math.min(room.nightWindowIndex + 1, total)} of ${total}`;
    return el;
  }

  if (room.phase === 'day') {
    el.classList.add('gameprogress--timer');
    el.dataset.discussionTimer = 'true';
    el.textContent = `${t(local.lang, 'phase.day')} · ${discussionTimerText(room) ?? '0:00'}`;
    setTimerUrgency(el, room);
    return el;
  }

  if (room.phase === 'lobby') {
    const minutes = Math.round((room.discussionMs ?? 15 * 60_000) / 60_000);
    el.textContent = `${t(local.lang, 'phase.lobby')} · ${minutes} ${t(local.lang, 'timer.minutes')}`;
    return el;
  }

  el.textContent = t(local.lang, `phase.${room.phase}`);
  return el;
}

/** A discoverable but deliberately quiet shortcut for solo/practice testing. */
function practiceVoteShortcut(): HTMLElement | null {
  const state = controller.current();
  const room = state.room;
  if (!state.roomId || !room || room.phase !== 'day'
    || room.mode !== 'practice' || room.refereeUid !== state.uid) return null;

  const row = document.createElement('div');
  row.className = 'practicevote';
  const force = button(t(local.lang, 'menu.forceVote'), () => {
    void attempt(() => backend.forcePracticeVote(state.roomId!));
  });
  force.classList.add('practicevote__button');
  force.disabled = local.busy;
  row.append(force);
  return row;
}

function joinExistingButton(): HTMLElement {
  return button(t(local.lang, 'join.open'), () => {
    local.error = null;
    controller.setJoining(true);
  });
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

  const table = button(t(local.lang, 'alltime.title'), () => {
    local.menuOpen = false;
    local.showAllTime = true;
    render();
  });
  table.classList.add('menu__item');
  sheet.append(table);

  const profiles = button(t(local.lang, 'friend.profiles'), () => {
    local.menuOpen = false;
    local.showProfiles = true;
    render();
  });
  profiles.classList.add('menu__item');
  sheet.append(profiles);

  const room = controller.current().room;
  if (code && room?.mode === 'practice' && room.refereeUid === backend.uid && room.phase === 'day') {
    const force = button(t(local.lang, 'menu.forceVote'), () => {
      local.menuOpen = false;
      void attempt(() => backend.forcePracticeVote(code));
    });
    force.classList.add('menu__item');
    sheet.append(force);
    const note = document.createElement('p');
    note.className = 'sheet__note';
    note.textContent = t(local.lang, 'menu.forceVoteNote');
    sheet.append(note);
  }

  const home = button(t(local.lang, 'menu.home'), returnHome);
  home.classList.add('menu__item');
  sheet.append(home);

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

function discussionMsFromInput(value: string): number | null {
  const minutes = Number(value);
  const ms = minutes * 60_000;
  return Number.isInteger(minutes) && ms >= MIN_DISCUSSION_MS && ms <= MAX_DISCUSSION_MS
    ? ms
    : null;
}

function discussionTimerText(room: { phase: string; discussionEndsAt?: number | null }): string | null {
  if (room.phase !== 'day' || room.discussionEndsAt == null) return null;
  const seconds = Math.max(0, Math.ceil((room.discussionEndsAt - Date.now()) / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function setTimerUrgency(
  element: HTMLElement,
  room: { phase: string; discussionEndsAt?: number | null },
): void {
  const remaining = room.discussionEndsAt == null
    ? Number.POSITIVE_INFINITY
    : room.discussionEndsAt - Date.now();
  element.classList.toggle(
    'discussiontimer--urgent',
    room.phase === 'day' && remaining > 0 && remaining <= 2 * 60_000,
  );
}

function refreshDiscussionTimer(): void {
  const room = controller.current().room;
  if (!room || room.phase !== 'day') return;
  const value = discussionTimerText(room) ?? '0:00';
  document.querySelectorAll<HTMLElement>('[data-discussion-timer="true"]').forEach((el) => {
    el.textContent = el.classList.contains('gameprogress')
      ? `${t(local.lang, 'phase.day')} · ${value}`
      : value;
    setTimerUrgency(el, room);
  });
}

void start();

/* ------------------------- what is on top of the table ------------------- */

/**
 * The sheet over the table, if anything is being asked right now.
 *
 * Order is the order of urgency at a real table: a night question you were
 * handed, then the vote, then the result. Only one at a time — two open sheets
 * is two people talking at once.
 */
function tableOverlay(): HTMLElement | null {
  const state = controller.current();
  const room = state.room;
  if (!room) return null;

  const ownSeat = room.seating.indexOf(state.uid);
  if (ownSeat < 0) return null;                 // not in this round

  const request = firstPending();
  if (request) return promptSheet(request, ownSeat as SeatIndex);

  const privateReceipt = nextPrivateReceipt();
  if (privateReceipt) return privateReceipt;

  if (room.phase === 'day' || room.phase === 'voting') {
    return voteSheet(ownSeat as SeatIndex);
  }
  if (room.phase === 'results' && room.finalRoles) {
    return resultSheet(ownSeat as SeatIndex);
  }
  return null;
}

/** A private reveal must stay readable after its choice sheet closes. */
function nextPrivateReceipt(): HTMLElement | null {
  const state = controller.current();
  const round = state.room?.round ?? null;
  if (local.privateInfoRound !== round) {
    local.privateInfoRound = round;
    local.acknowledgedPrivateInfo = 0;
  }
  const info = state.own.privateInfo[local.acknowledgedPrivateInfo];
  if (!info) return null;

  const message = document.createElement('p');
  message.className = 'sheet__sub';
  message.textContent = describeReveal(
    local.lang,
    info,
    (seat) => seatNames()[seat as SeatIndex] ?? String(seat + 1),
    (role) => roleName(local.lang, role as RoleId),
  );
  return renderSheet({
    title: local.lang === 'nl' ? 'Wat je zag' : 'What you saw',
    variant: 'receipt',
    body: message,
    actions: [{
      label: local.lang === 'nl' ? 'Verder' : 'Continue',
      primary: true,
      onSelect: () => {
        local.acknowledgedPrivateInfo += 1;
        render();
      },
    }],
    dismissable: false,
    passiveScrim: true,
  });
}

function seatNames(): Record<SeatIndex, string> {
  const state = controller.current();
  const byUid = new Map(state.players.map((p) => [p.uid, p.displayName]));
  const names: Record<SeatIndex, string> = {};
  (state.room?.seating ?? []).forEach((uid, seat) => {
    names[seat as SeatIndex] = byUid.get(uid) ?? uid;
  });
  return names;
}

function promptSheet(
  request: NonNullable<ReturnType<typeof firstPending>>,
  ownSeat: SeatIndex,
): HTMLElement {
  const state = controller.current();
  const send = async (choice: Choice) => {
    const roomId = state.roomId;
    if (!roomId || !state.room) return;
    const saved = await attempt(() => backend.submit(
      roomId,
      state.room!.nightWindowIndex,
      { [request.key]: choice },
    ));
    if (!saved) return;
    local.submittedDecisionKeys.push(request.key);
    local.picked = [];
    local.pickedCenters = [];
    render();
  };

  return renderSheet({
    title: t(local.lang, 'phase.night'),
    variant: 'night',
    body: renderPrompt({
      lang: local.lang,
      request,
      names: seatNames(),
      ownSeat,
      picked: local.picked,
      pickedCenters: local.pickedCenters,
      centerCount: 3,
      onPickSeat: (seat) => actions.onCardTap(seat),
      onPickCenter: (index) => {
        if (request.prompt.kind === 'seat-or-center') local.picked = [];
        const count = request.prompt.kind === 'center'
          ? request.prompt.count
          : request.prompt.kind === 'seat-or-center'
            ? request.prompt.centerCount
            : 1;
        local.pickedCenters = toggleCenterPick(local.pickedCenters, index, count);
        render();
      },
      onConfirm: send,
      // Declining is a real answer. A window that closes on somebody who meant
      // to do nothing has to record that, or their seat never settles and they
      // receive none of their reveals.
      onDecline: () => send({ kind: 'none' }),
    }),
    note: t(local.lang, 'reveal.staleWarning'),
    passiveScrim: true,
  });
}

/** Narrowing helper so promptSheet can name the type without importing it. */
function firstPending() {
  const state = controller.current();
  const room = state.room;
  const marker = room ? `${room.round}:${room.nightWindowIndex}` : null;
  if (local.decisionWindow !== marker) {
    local.decisionWindow = marker;
    local.submittedDecisionKeys = [];
  }
  return nextPendingRequest(
    state.own.pending,
    local.submittedDecisionKeys,
    room?.phase ?? 'lobby',
  );
}

function voteSheet(ownSeat: SeatIndex): HTMLElement {
  const state = controller.current();
  const room = state.room!;
  const roomId = state.roomId!;

  const cast = (target: SeatIndex | null, abstain: boolean) => {
    const uid = target === null ? null : (room.seating[target] ?? null);
    void attempt(() => backend.vote(roomId, uid, abstain));
  };

  return renderSheet({
    title: t(local.lang, room.phase === 'voting' ? 'day.voteNow' : 'day.discussing'),
    body: renderVoting({
      lang: local.lang,
      ownSeat,
      names: seatNames(),
      target: local.voteTarget,
      abstain: local.abstaining,
      abstainCount: room.abstainCount,
      seatCount: room.seating.length,
      votesCast: room.votesCast,
      votingOpen: room.phase === 'voting',
      // What this device BELIEVES it is, from its own dealt card. The engine
      // resolves the shield on whoever holds the Bodyguard card at dawn, so a
      // player swapped away from it goes on shielding nobody (§6.0).
      isBodyguard: state.own.originalRole === 'bodyguard',
      onTarget: (seat) => {
        local.voteTarget = local.voteTarget === seat ? null : seat;
        render();
      },
      // §7: the abstain toggle is live from the first second of the
      // discussion and counts at any moment, so it is sent immediately rather
      // than waiting for a confirm.
      onAbstain: (next) => {
        local.abstaining = next;
        cast(next ? null : local.voteTarget, next);
        render();
      },
      onConfirm: () => cast(local.voteTarget, false),
      readyToVote: local.readyToVote,
      earlyVoteCount: room.earlyVoteCount,
      // Sent immediately, like the abstain, because it is counted
      // simultaneously — a request that only lands when you confirm something
      // else is not a show of hands.
      onReadyToVote: (next) => {
        local.readyToVote = next;
        void attempt(() => backend.requestEarlyVote(roomId, next));
        render();
      },
    }),
    variant: 'vote',
    passiveScrim: true,
  });
}

/**
 * What the table sees at dawn.
 *
 * Built from the PUBLIC room document — `outcome` and `finalRoles`, the two
 * things `publishResults` makes public — rather than from the referee's
 * `DayResult`. That object has per-seat vote outcomes the room never
 * publishes, and reaching for it here would mean either inventing values or
 * reading something this device is not supposed to have. The per-player
 * record lives in the append-only results documents, which the stats screens
 * already aggregate from.
 */
function resultSheet(ownSeat: SeatIndex): HTMLElement {
  const room = controller.current().room!;
  const names = seatNames();

  const body = document.createElement('div');

  const headline = document.createElement('p');
  headline.className = 'sheet__sub';
  headline.textContent = room.outcome ?? '';
  body.append(headline);

  const list = document.createElement('div');
  list.className = 'results__seats';
  for (const [seatKey, role] of Object.entries(room.finalRoles ?? {})) {
    const seat = Number(seatKey) as SeatIndex;
    const row = document.createElement('p');
    row.className = 'results__row';
    if (seat === ownSeat) row.classList.add('results__row--own');
    // Every card at dawn, which is the ONE moment roles become public.
    row.textContent = `${names[seat] ?? seat}: ${roleName(local.lang, role)}`;
    list.append(row);
  }
  body.append(list);

  const state = controller.current();
  return renderSheet({
    title: t(local.lang, 'results.title'),
    variant: 'result',
    body,
    ...(state.room && canDeal(state.room, state.uid)
      ? { actions: [{ label: t(local.lang, 'results.nextRound'), primary: true, onSelect: actions.onDeal }] }
      : {}),
    passiveScrim: true,
  });
}

/* --------------------------- who you are, all-time ----------------------- */

function friendPicker(onPicked?: () => void): HTMLElement {
  return renderFriendPicker({
    lang: local.lang,
    profiles: local.friends,
    rememberedId: rememberedFriendId(),
    typed: local.friendTyped,
    busy: local.busy,
    onTyped: (value) => {
      local.friendTyped = value;
    },
    onPick: (profile) => {
      local.friend = profile;
      // Remembered so the common case is one tap next time. Losing it costs
      // nothing: the list is shared, so picking the same name gets the SAME
      // profile — which is the whole difference from keying off the uid.
      rememberFriendId(profile.id);
      if (!local.displayName) local.displayName = profile.displayName;
      onPicked?.();
      render();
    },
    onCreate: (displayName) => {
      void attempt(async () => {
        const profile = await backend.createFriend(displayName);
        local.friend = profile;
        local.friendTyped = '';
        rememberFriendId(profile.id);
        if (!local.displayName) local.displayName = profile.displayName;
        onPicked?.();
      });
    },
  });
}

/**
 * The all-time table.
 *
 * Practice rounds are filtered out by never having been written, so this is
 * simply everything there is — and the totals are recomputed here from the
 * rows rather than read from any stored number.
 */
function allTimeSheet(): HTMLElement {
  const body = renderAllTime({
    lang: local.lang,
    rows: allTimeStandings(local.history),
    ownFriendId: local.friend?.id ?? null,
    // The sheet supplies the heading.
    heading: false,
  });
  return renderSheet({
    title: t(local.lang, 'alltime.title'),
    body,
    onDismiss: () => {
      local.showAllTime = false;
      render();
    },
  });
}

/** The shared address book remains reachable after entering a room. */
function profileSheet(): HTMLElement {
  return renderSheet({
    title: t(local.lang, 'friend.profiles'),
    body: friendPicker(() => { local.showProfiles = false; }),
    onDismiss: () => {
      local.showProfiles = false;
      render();
    },
  });
}
