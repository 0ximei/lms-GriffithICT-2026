(() => {
  if (window.__rfvTikTokReelsInjected) return;
  window.__rfvTikTokReelsInjected = true;

  // Canvas LMS renders one of these per course card on the dashboard; it's the
  // coloured/image banner at the top of each card.
  const HERO_SELECTOR = '.ic-DashboardCard__header_hero';
  const STEP_COOLDOWN_MS = 350;
  // Consecutive fetches that return only already-seen reels before we accept
  // the feed has nothing more to give and start reusing clips.
  const MAX_BARREN_FETCHES = 3;

  async function isLmsSite() {
    let response = await fetch("https://" + location.hostname + "/web-app-manifest/manifest.json");
    if (response.ok) {
      let res = await response.json();
      if (res.name == "Canvas") {
        return true;
      }
    }
    return false;
    // return /(^|\.)griffith\.edu\.au$/.test(location.hostname);
  }

  const MIN_SCROLLS_BETWEEN_BREAKS = 2;
  const MAX_SCROLLS_BETWEEN_BREAKS = 10;
  const MIN_BREAK_SECONDS = 40;
  const MAX_BREAK_SECONDS = 5 * 60;

  // Only the first course card plays a reel; the rest start locked.
  const DEFAULT_UNLOCKED_SLOTS = 1;
  const SLOTS_STORAGE_KEY = 'rfvUnlockedSlots';
  const SLOT_MAP_STORAGE_KEY = 'rfvSlotByCourse';
  const BREAKS_STORAGE_KEY = 'rfvActiveBreaks';
  const MUTED_STORAGE_KEY = 'rfvMuted';
  const STATS_STORAGE_KEY = 'rfvStats';
  const PRO_STORAGE_KEY = 'rfvPro';
  const PRO_PRICE = '4.99';
  // Share of card slots held back as ad inventory rather than showing a reel.
  const AD_SLOT_PERCENT = 5;
  const AD_DAY_RATE = 12;
  // A reel held for at least this long counts as actually watched rather than
  // scrolled past — the numerator of the scroll-efficiency figure.
  const ENGAGED_MS = 3000;
  // Rolling utilisation monitor: one sample a second over a one-minute window.
  const MONITOR_SAMPLES = 60;
  const MONITOR_INTERVAL_MS = 1000;
  // Hold-to-speed-up in the expanded player.
  const LONG_PRESS_MS = 300;
  const FAST_PLAYBACK_RATE = 2;

  // Simulated pricing for the demo unlock flow — nothing is ever charged.
  function slotPrice(slotNumber) {
    return (0.99 * 2 ** Math.max(0, slotNumber - 2)).toFixed(2);
  }

  function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const state = {
    // Accumulated pool of unique reels. Stepping pulls further into this list
    // rather than wrapping, so a card never repeats a reel already shown.
    videos: [],
    seenIds: new Set(),
    fetchChain: null,
    // blob: URLs are cached per source url so cards that reuse a reel don't
    // download the same video twice.
    blobUrls: new Map(),
    scanQueued: false,
    reportedError: false,
    control: null,
    // How far the whole dashboard has advanced. Stepped by the number of
    // course cards so each step reveals an entirely fresh set of reels.
    stepOffset: 0,
    // Bumped on each step so a late download from an earlier press can be
    // discarded instead of overwriting the current reel.
    stepGeneration: 0,
    lastStepAt: 0,
    lastWatchedHero: null,
    // Breaks read from storage at load, waiting for their card to render.
    pendingBreaks: new Map(),
    scrollsSinceBreak: 0,
    scrollsBeforeBreak: randomInteger(MIN_SCROLLS_BETWEEN_BREAKS, MAX_SCROLLS_BETWEEN_BREAKS),
    unlockedSlots: DEFAULT_UNLOCKED_SLOTS,
    pro: false,
    bannerDismissed: false,
    muted: false,
    // Browsers only allow autoplay with sound after the user has interacted
    // with the page, so reels start silent and switch on at the first gesture.
    audioPrimed: false,
    // { hero, videoEl, index, loading, lastStepAt } while the big player is open.
    viewer: null,
    previousBodyOverflow: '',
    // Rolling window of utilisation percentages, oldest first. Sampled from
    // page load so the monitor already has history when the panel is opened.
    utilization: [],
    scrollTimes: [],
    monitorTimer: null,
    sessionStart: Date.now(),
    stats: {
      scrolls: 0,
      engaged: 0,
      reelsSeen: 0,
      playerMs: 0,
      bytes: 0,
      breaks: 0,
      spend: 0,
      dailyScrolls: {},
      firstSeen: Date.now(),
    },
  };

  // hero element -> { videoEl, baseIndex }
  const reels = new Map();
  // Every hero we've seen -> its slot number, locked or not, so slots can be
  // filled in later when one is unlocked.
  const heroSlots = new Map();
  // course href -> slot number, so a course keeps its slot across the DOM
  // rebuilds Canvas does when it re-renders the dashboard.
  const slotByCourse = new Map();
  // feed position -> whether it drew an ad. See isAdSlot.
  const adRolls = new Map();
  // Cards currently on a screen break -> { timer, endsAt }. Breaks stack, so
  // several cards can be resting at once, each on its own countdown.
  const restingHeroes = new Map();

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get({
        [SLOTS_STORAGE_KEY]: DEFAULT_UNLOCKED_SLOTS,
        [MUTED_STORAGE_KEY]: false,
        [STATS_STORAGE_KEY]: null,
        [PRO_STORAGE_KEY]: false,
        [SLOT_MAP_STORAGE_KEY]: null,
        [BREAKS_STORAGE_KEY]: null,
      });

      // Breaks in progress, so a refresh doesn't hand back a card the user is
      // meant to be resting from. Anything already expired is dropped.
      const storedBreaks = stored[BREAKS_STORAGE_KEY];
      if (storedBreaks && typeof storedBreaks === 'object') {
        const now = Date.now();
        for (const [key, rest] of Object.entries(storedBreaks)) {
          if (rest?.endsAt > now) state.pendingBreaks.set(key, rest);
        }
      }
      state.pro = Boolean(stored[PRO_STORAGE_KEY]);

      // Restore which slot each course holds. Without this the assignment is
      // rebuilt from DOM order every load, so a reordered dashboard would hand
      // the unlocked slot to a different course.
      const storedSlots = stored[SLOT_MAP_STORAGE_KEY];
      if (storedSlots && typeof storedSlots === 'object') {
        for (const [key, slot] of Object.entries(storedSlots)) {
          if (Number.isInteger(slot)) slotByCourse.set(key, slot);
        }
      }
      state.unlockedSlots = Math.max(DEFAULT_UNLOCKED_SLOTS, Number(stored[SLOTS_STORAGE_KEY]) || DEFAULT_UNLOCKED_SLOTS);
      state.muted = Boolean(stored[MUTED_STORAGE_KEY]);
      if (stored[STATS_STORAGE_KEY]) {
        state.stats = { ...state.stats, ...stored[STATS_STORAGE_KEY] };
      }
    } catch {
      state.unlockedSlots = DEFAULT_UNLOCKED_SLOTS;
    }
  }

  function saveUnlockedSlots() {
    chrome.storage.local.set({ [SLOTS_STORAGE_KEY]: state.unlockedSlots }).catch(() => {});
  }

  function saveActiveBreaks() {
    const active = {};

    for (const [hero, rest] of restingHeroes) {
      const key = courseKeyFor(hero);
      if (key) active[key] = { endsAt: rest.endsAt, duration: rest.duration };
    }

    chrome.storage.local.set({ [BREAKS_STORAGE_KEY]: active }).catch(() => {});
  }

  function saveSlotAssignments() {
    chrome.storage.local
      .set({ [SLOT_MAP_STORAGE_KEY]: Object.fromEntries(slotByCourse) })
      .catch(() => {});
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  let saveStatsTimer = null;
  function saveStats() {
    // Stats tick on every scroll; batch the writes rather than hitting storage
    // once per wheel event.
    window.clearTimeout(saveStatsTimer);
    saveStatsTimer = window.setTimeout(() => {
      chrome.storage.local.set({ [STATS_STORAGE_KEY]: state.stats }).catch(() => {});
    }, 400);
  }

  function recordScroll() {
    const stats = state.stats;
    stats.scrolls += 1;
    stats.dailyScrolls[todayKey()] = (stats.dailyScrolls[todayKey()] ?? 0) + 1;
    state.scrollTimes.push(Date.now());
    saveStats();
  }

  // Utilisation is counted the way a multi-core CPU meter counts load: each
  // unlocked slot is one "core" worth 100%, so five reels playing reads 500%
  // and ten reads 1000%. Full capacity is therefore slots × 100.
  function monitorCapacity() {
    return Math.max(100, reels.size * 100);
  }

  function reelsPlaying() {
    return Array.from(reels.values()).filter(
      ({ videoEl }) => !videoEl.paused && !videoEl.ended && videoEl.readyState >= 2
    ).length;
  }

  function currentUtilization() {
    // With the big player open you're watching one reel at full attention,
    // even though every card behind it is deliberately paused.
    if (state.viewer && !state.viewer.videoEl.paused) return 100;

    return reelsPlaying() * 100;
  }

  function scrollsPerMinute() {
    const cutoff = Date.now() - 60000;
    state.scrollTimes = state.scrollTimes.filter((time) => time >= cutoff);
    return state.scrollTimes.length;
  }

  function sampleUtilization() {
    state.utilization.push(currentUtilization());
    if (state.utilization.length > MONITOR_SAMPLES) {
      state.utilization.shift();
    }
  }

  function startUtilizationSampling() {
    if (state.monitorTimer) return;
    // Seed the window so the chart has a baseline rather than one lone point.
    state.utilization = new Array(MONITOR_SAMPLES).fill(0);
    state.monitorTimer = window.setInterval(sampleUtilization, MONITOR_INTERVAL_MS);
  }

  function recordReelShown() {
    state.stats.reelsSeen += 1;
    saveStats();
  }

  function recordBytes(bytes) {
    state.stats.bytes += bytes;
    saveStats();
  }

  function recordBreakTaken() {
    state.stats.breaks += 1;
    saveStats();
  }

  function recordSpend(amount) {
    state.stats.spend += Number(amount) || 0;
    saveStats();
  }

  // Called when a reel leaves the player, so dwell decides whether it counted
  // as watched or merely scrolled past.
  function recordDwell(startedAt) {
    if (!startedAt) return;
    const dwell = Date.now() - startedAt;
    state.stats.playerMs += dwell;
    if (dwell >= ENGAGED_MS) state.stats.engaged += 1;
    saveStats();
  }

  // Muted autoplay is always permitted; unmuted autoplay is not. Keep reels
  // silent until the page has seen a real user gesture, then switch sound on.
  function shouldMuteNow() {
    return state.muted || !state.audioPrimed;
  }

  function applyMuteState() {
    const muted = shouldMuteNow();

    for (const { videoEl } of reels.values()) {
      videoEl.muted = muted;
      if (!muted) videoEl.volume = 1;
      videoEl.play().catch(() => {});
    }

    const soundButton = state.control?.querySelector('.rfv-reel-control__sound');
    if (soundButton) {
      soundButton.textContent = state.muted ? '🔇' : '🔊';
      soundButton.title = state.muted ? 'Unmute reels' : 'Mute reels';
      soundButton.setAttribute('aria-label', soundButton.title);
      soundButton.setAttribute('aria-pressed', String(!state.muted));
    }
  }

  function toggleMute() {
    state.muted = !state.muted;
    state.audioPrimed = true;
    chrome.storage.local.set({ [MUTED_STORAGE_KEY]: state.muted }).catch(() => {});
    applyMuteState();
  }

  // The first click/keypress anywhere counts as the gesture that lets audio
  // start, so reels come off mute without the user having to hunt for a button.
  function primeAudioOnFirstGesture() {
    const onGesture = () => {
      if (state.audioPrimed) return;
      state.audioPrimed = true;
      applyMuteState();
    };

    document.addEventListener('pointerdown', onGesture, { capture: true, once: true });
    document.addEventListener('keydown', onGesture, { capture: true, once: true });
  }

  function closeProDialog() {
    document.querySelector('.rfv-pro')?.remove();
  }

  function activatePro() {
    state.pro = true;
    chrome.storage.local.set({ [PRO_STORAGE_KEY]: true }).catch(() => {});

    // Slots stay locked — Pro only buys out of the screen breaks. Every card
    // currently resting comes back now rather than making the user sit out
    // timers they just paid to skip.
    clearAllEyeBreaks();
    state.scrollsSinceBreak = 0;
    refreshPromoBanner();
  }

  function openProDialog() {
    if (document.querySelector('.rfv-pro')) return;

    const dialog = document.createElement('div');
    dialog.className = 'rfv-pro';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
      <div class="rfv-pro__panel">
        <p class="rfv-pro__kicker">Reel Fullscreen</p>
        <h2 class="rfv-pro__title">Go Pro</h2>
        <ul class="rfv-pro__benefits">
          <li>Never see a screen break again</li>
          <li>Scroll without interruption</li>
        </ul>
        <div class="rfv-pro__actions">
          <button type="button" class="rfv-pro__buy">Subscribe — $${PRO_PRICE}/month</button>
          <button type="button" class="rfv-pro__close">Not now</button>
        </div>
        <p class="rfv-pro__note">Demo only — no payment is taken and no details are collected.</p>
      </div>
    `;

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeProDialog();
    });
    dialog.querySelector('.rfv-pro__close').addEventListener('click', closeProDialog);
    dialog.querySelector('.rfv-pro__buy').addEventListener('click', () => {
      activatePro();
      closeProDialog();
    });

    document.body.appendChild(dialog);
    dialog.querySelector('.rfv-pro__buy').focus();
  }

  function removePromoBanner() {
    document.getElementById('rfv-promo')?.remove();
    document.body.style.paddingTop = state.previousBodyPadding ?? '';
  }

  function refreshPromoBanner() {
    if (state.pro || state.bannerDismissed) {
      removePromoBanner();
      return;
    }
    injectPromoBanner();
  }

  function injectPromoBanner() {
    if (state.pro || state.bannerDismissed) return;
    if (document.getElementById('rfv-promo') || !document.body) return;

    const banner = document.createElement('div');
    banner.id = 'rfv-promo';
    banner.className = 'rfv-promo';
    banner.innerHTML = `
      <span class="rfv-promo__tag">Pro</span>
      <p class="rfv-promo__text">
        Screen breaks interrupting your scrolling?
        <strong>Upgrade to Pro</strong> to turn them off.
      </p>
      <button type="button" class="rfv-promo__cta">Upgrade — $${PRO_PRICE}/mo</button>
      <button type="button" class="rfv-promo__dismiss" title="Dismiss" aria-label="Dismiss promotion">✕</button>
    `;

    banner.querySelector('.rfv-promo__cta').addEventListener('click', openProDialog);
    banner.querySelector('.rfv-promo__dismiss').addEventListener('click', () => {
      state.bannerDismissed = true;
      removePromoBanner();
    });

    // Push Canvas's own header down rather than covering it.
    state.previousBodyPadding = document.body.style.paddingTop;
    document.body.prepend(banner);
    document.body.style.paddingTop = `${banner.offsetHeight}px`;
  }

  function formatCountdown(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  function isHeroResting(hero) {
    return Boolean(hero) && restingHeroes.has(hero);
  }

  // Ends one card's break. Breaks run per card and overlap, so each clears
  // independently rather than tearing down a single shared timer.
  function clearEyeBreak(hero) {
    const rest = restingHeroes.get(hero);
    if (!rest) return;

    window.clearInterval(rest.timer);
    restingHeroes.delete(hero);
    saveActiveBreaks();

    hero.querySelector('.rfv-eye-break')?.remove();
    hero.classList.remove('rfv-resting-hero');

    // Put the rested card back to work.
    const entry = reels.get(hero);
    if (entry && hero.isConnected) {
      showVideoAt(hero, entry.videoEl, entry.baseIndex + state.stepOffset).catch(() => {});
    }
  }

  function clearAllEyeBreaks() {
    for (const hero of [...restingHeroes.keys()]) {
      clearEyeBreak(hero);
    }
  }

  // The card the next break lands on: whichever the user was actually
  // watching, else something still playing. Cards already resting are skipped
  // so a second break lands somewhere new.
  function breakTargetHero() {
    const available = (hero) => hero?.isConnected && reels.has(hero) && !isHeroResting(hero);

    if (available(state.viewer?.hero)) return state.viewer.hero;
    if (available(state.lastWatchedHero)) return state.lastWatchedHero;

    for (const [hero, { videoEl }] of reels) {
      if (available(hero) && !videoEl.paused) return hero;
    }

    for (const hero of reels.keys()) {
      if (available(hero)) return hero;
    }

    return null;
  }

  // Puts one card on a break that ends at `endsAt`. Split out from
  // startEyeBreak so a break interrupted by a page reload can be rebuilt with
  // its original end time rather than restarting from full duration.
  function beginBreakOn(hero, endsAt, duration) {
    if (!hero || isHeroResting(hero)) return;

    // The break covers the card, so the expanded player has to step aside.
    if (state.viewer?.hero === hero) closeReelViewer();

    reels.get(hero)?.videoEl.pause();
    hideAdOverlay(hero);

    const secondsRemaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const breakOverlay = document.createElement('div');
    breakOverlay.className = 'rfv-eye-break';
    breakOverlay.innerHTML = `
      <p class="rfv-eye-break-kicker">Screen break</p>
      <div class="rfv-eye-break-timer" role="timer" aria-label="Break time remaining">
        <span class="rfv-eye-break-countdown">${formatCountdown(secondsRemaining)}</span>
      </div>
      <p class="rfv-eye-break-copy">Rest your eyes — your other courses are still playing.</p>
      <button type="button" class="rfv-eye-break-upgrade">Skip with Pro</button>
    `;

    const countdown = breakOverlay.querySelector('.rfv-eye-break-countdown');
    const timer = breakOverlay.querySelector('.rfv-eye-break-timer');
    breakOverlay.querySelector('.rfv-eye-break-upgrade').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openProDialog();
    });

    if (getComputedStyle(hero).position === 'static') {
      hero.style.position = 'relative';
    }

    hero.classList.add('rfv-resting-hero');
    hero.appendChild(breakOverlay);

    function updateTimer() {
      const secondsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      countdown.textContent = formatCountdown(secondsLeft);
      timer.style.setProperty('--rfv-break-progress', String(secondsLeft / duration));

      // Only this card comes back; any other card still resting keeps its own
      // timer running.
      if (secondsLeft === 0) clearEyeBreak(hero);
    }

    restingHeroes.set(hero, { timer: window.setInterval(updateTimer, 250), endsAt, duration });
    updateTimer();
    saveActiveBreaks();
  }

  function startEyeBreak() {
    // Pro subscribers never get interrupted.
    if (state.pro) return;

    // Null once every card is already resting — nothing left to rest.
    const hero = breakTargetHero();
    if (!hero) return;

    const duration = randomInteger(MIN_BREAK_SECONDS, MAX_BREAK_SECONDS);
    beginBreakOn(hero, Date.now() + duration * 1000, duration);
    recordBreakTaken();
  }

  // Reinstates a break that was still running when the page was reloaded.
  function restoreBreakFor(hero) {
    if (state.pro || !state.pendingBreaks.size) return;

    const key = courseKeyFor(hero);
    const pending = key && state.pendingBreaks.get(key);
    if (!pending) return;

    state.pendingBreaks.delete(key);
    if (pending.endsAt <= Date.now()) return;

    beginBreakOn(hero, pending.endsAt, pending.duration);
  }

  function recordFeedScroll() {
    recordScroll();
    // Breaks stack: keep counting while cards are resting, so continuing to
    // scroll puts more of the dashboard on a break rather than none.
    state.scrollsSinceBreak += 1;
    if (state.scrollsSinceBreak >= state.scrollsBeforeBreak) {
      state.scrollsSinceBreak = 0;
      state.scrollsBeforeBreak = randomInteger(MIN_SCROLLS_BETWEEN_BREAKS, MAX_SCROLLS_BETWEEN_BREAKS);
      startEyeBreak();
    }
  }

  async function fetchTikTokVideos() {
    const response = await chrome.runtime.sendMessage({ type: 'getTikTokVideoIds' });
    if (response?.error) {
      throw new Error(response.error);
    }
    return Array.isArray(response?.videos) ? response.videos.filter(Boolean) : [];
  }

  function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }


  async function gamble() {
    const gambleResult = Math.random() < 0.5;
    if (gambleResult) {
      console.log("more reels")
    } else {
      console.log("you need to wait ... seconds")
      await wait(10000);
      console.log("10 seconds have passed")
      return;
    }
  }


  // Each call hits TIKTOK_API_URL again for another batch. It's a
  // recommendation feed, so an occasional all-duplicate batch is normal —
  // retry a few times before giving up rather than treating one as the end.
  async function fillTo(minCount) {
    let barrenFetches = 0;

    while (state.videos.length < minCount && barrenFetches < MAX_BARREN_FETCHES) {
      const batch = await fetchTikTokVideos();
      const before = state.videos.length;

      for (const video of batch) {
        if (state.seenIds.has(video.id)) continue;
        state.seenIds.add(video.id);
        state.videos.push(video);
      }

      barrenFetches = state.videos.length === before ? barrenFetches + 1 : 0;
    }

    return state.videos;
  }

  // Serialized: cards attach concurrently and would otherwise all fire their
  // own fetch for the same range.
  function ensureVideos(minCount) {
    // Fast path: the pool already covers this range, so don't join the fetch
    // chain. Without this every card queues behind every other card on each
    // step, turning a no-op into N sequential awaits.
    if (state.videos.length >= minCount) {
      return Promise.resolve(state.videos);
    }

    state.fetchChain = (state.fetchChain ?? Promise.resolve()).then(() => fillTo(minCount));
    return state.fetchChain;
  }

  function onViewerKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReelViewer();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      stepViewer(1);
    }
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      stepViewer(-1);
    }
  }

  function updateViewerBadge() {
    const viewer = state.viewer;
    if (!viewer?.badge) return;
    viewer.badge.textContent = `Reel ${viewer.index + 1}`;
  }

  // Advances only the open viewer, leaving every dashboard card alone. The
  // card this was opened from is re-pointed at the same reel so closing the
  // viewer doesn't snap back to the clip you scrolled away from.
  async function stepViewer(step) {
    const viewer = state.viewer;
    // Only blocked if the card behind this player is the one resting.
    if (!viewer || viewer.loading || isHeroResting(viewer.hero)) return;

    const now = Date.now();
    if (now - viewer.lastStepAt < STEP_COOLDOWN_MS) return;

    const nextIndex = Math.max(0, viewer.index + step);
    if (nextIndex === viewer.index) return;

    viewer.loading = true;
    viewer.lastStepAt = now;
    viewer.stage?.classList.add('is-loading');
    viewer.stage?.classList.toggle('is-stepping-back', step < 0);

    try {
      const videos = await ensureVideos(nextIndex + 1);
      if (!videos.length) return;

      const safeIndex = nextIndex < videos.length ? nextIndex : nextIndex % videos.length;
      const blobUrl = await getBlobUrl(videos[safeIndex].videoUrl);

      if (!viewer.videoEl.isConnected) return;

      recordDwell(viewer.shownAt);
      viewer.shownAt = Date.now();
      recordReelShown();

      viewer.index = nextIndex;
      if (viewer.progressFill) viewer.progressFill.style.width = '0%';
      updateViewerBadge();
      // playbackRate survives a src change, so a new reel would start at 2x.
      viewer.videoEl.playbackRate = 1;
      viewer.stage?.classList.remove('is-fast');
      viewer.videoEl.src = blobUrl;
      viewer.videoEl.load();
      viewer.videoEl.play().catch(() => {});

      // Keep the originating card on the same reel. baseIndex is stored
      // relative to stepOffset so the global control keeps working afterwards.
      const entry = reels.get(viewer.hero);
      if (entry) {
        entry.baseIndex = nextIndex - state.stepOffset;
        entry.videoEl.src = blobUrl;
        entry.videoEl.load();
      }

      recordFeedScroll();
    } finally {
      viewer.loading = false;
      viewer.stage?.classList.remove('is-loading');
    }
  }

  function closeReelViewer() {
    const viewer = document.querySelector('.rfv-viewer');
    if (!viewer) return;

    recordDwell(state.viewer?.shownAt);

    viewer.remove();
    state.viewer = null;
    document.removeEventListener('keydown', onViewerKey, true);
    document.body.style.overflow = state.previousBodyOverflow ?? '';

    // Resume the dashboard reels that were paused while the viewer was open.
    for (const { videoEl } of reels.values()) {
      videoEl.play().catch(() => {});
    }
  }

  function openReelViewer(hero, sourceVideoEl) {
    if (document.querySelector('.rfv-viewer')) return;

    // Pause every card reel so its audio doesn't play under the viewer.
    for (const { videoEl } of reels.values()) {
      videoEl.pause();
    }

    const viewer = document.createElement('div');
    viewer.className = 'rfv-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Reel');

    const stage = document.createElement('div');
    stage.className = 'rfv-viewer__stage';
    stage.innerHTML = `
      <video class="rfv-viewer__video" playsinline webkit-playsinline loop autoplay></video>
      <div class="rfv-viewer__scrim rfv-viewer__scrim--top"></div>
      <div class="rfv-viewer__scrim rfv-viewer__scrim--bottom"></div>
      <div class="rfv-viewer__spinner" aria-hidden="true"></div>
      <div class="rfv-viewer__speed" aria-hidden="true">2× speed</div>

      <div class="rfv-viewer__top">
        <span class="rfv-viewer__badge"></span>
        <button type="button" class="rfv-viewer__icon rfv-viewer__close" title="Close" aria-label="Close reel">✕</button>
      </div>

      <div class="rfv-viewer__nav">
        <button type="button" class="rfv-viewer__icon rfv-viewer__nav-btn" data-step="-1" title="Previous reel" aria-label="Previous reel">︿</button>
        <button type="button" class="rfv-viewer__icon rfv-viewer__nav-btn" data-step="1" title="Next reel" aria-label="Next reel">﹀</button>
      </div>

      <div class="rfv-viewer__bottom">
        <div class="rfv-viewer__progress" role="slider" tabindex="0"
             aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="rfv-viewer__progress-fill"></div>
        </div>
        <div class="rfv-viewer__actions">
          <button type="button" class="rfv-viewer__icon rfv-viewer__play" title="Pause" aria-label="Pause">❚❚</button>
          <button type="button" class="rfv-viewer__icon rfv-viewer__sound" title="Mute" aria-label="Mute">🔊</button>
          <span class="rfv-viewer__hint">Scroll for the next reel</span>
        </div>
      </div>
    `;

    const videoEl = stage.querySelector('.rfv-viewer__video');
    const badge = stage.querySelector('.rfv-viewer__badge');
    const progress = stage.querySelector('.rfv-viewer__progress');
    const progressFill = stage.querySelector('.rfv-viewer__progress-fill');
    const playButton = stage.querySelector('.rfv-viewer__play');
    const soundButton = stage.querySelector('.rfv-viewer__sound');
    const closeButton = stage.querySelector('.rfv-viewer__close');

    videoEl.src = sourceVideoEl.currentSrc || sourceVideoEl.src;
    videoEl.volume = 1;

    // Pick up where the card left off rather than restarting the clip.
    videoEl.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(sourceVideoEl.currentTime)) {
          videoEl.currentTime = sourceVideoEl.currentTime;
        }
        videoEl.play().catch(() => {});
      },
      { once: true }
    );

    videoEl.addEventListener('timeupdate', () => {
      if (!videoEl.duration) return;
      const percent = (videoEl.currentTime / videoEl.duration) * 100;
      progressFill.style.width = `${percent}%`;
      progress.setAttribute('aria-valuenow', String(Math.round(percent)));
    });

    const syncPlayButton = () => {
      const paused = videoEl.paused;
      playButton.textContent = paused ? '▶' : '❚❚';
      playButton.title = paused ? 'Play' : 'Pause';
      playButton.setAttribute('aria-label', playButton.title);
    };
    videoEl.addEventListener('play', syncPlayButton);
    videoEl.addEventListener('pause', syncPlayButton);

    const syncSoundButton = () => {
      soundButton.textContent = videoEl.muted ? '🔇' : '🔊';
      soundButton.title = videoEl.muted ? 'Unmute' : 'Mute';
      soundButton.setAttribute('aria-label', soundButton.title);
    };
    syncSoundButton();

    // Hold to run at 2x, release to drop back — the gesture every reel app
    // has. The press has to outlast LONG_PRESS_MS so an ordinary tap still
    // reads as play/pause.
    let pressTimer = null;
    let didLongPress = false;

    const startPress = (event) => {
      if (event.button !== 0) return;
      didLongPress = false;
      pressTimer = window.setTimeout(() => {
        didLongPress = true;
        videoEl.playbackRate = FAST_PLAYBACK_RATE;
        stage.classList.add('is-fast');
      }, LONG_PRESS_MS);
    };

    const endPress = () => {
      window.clearTimeout(pressTimer);
      pressTimer = null;
      videoEl.playbackRate = 1;
      stage.classList.remove('is-fast');
    };

    videoEl.addEventListener('pointerdown', startPress);
    videoEl.addEventListener('pointerup', endPress);
    videoEl.addEventListener('pointercancel', endPress);
    videoEl.addEventListener('pointerleave', endPress);
    // A long press on touch would otherwise raise the context menu mid-hold.
    videoEl.addEventListener('contextmenu', (event) => event.preventDefault());

    // Clicking the video toggles playback, the way a reel player should.
    videoEl.addEventListener('click', () => {
      // The click that ends a long press shouldn't also pause the video.
      if (didLongPress) {
        didLongPress = false;
        return;
      }

      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    });

    playButton.addEventListener('click', () => {
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    });

    soundButton.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      syncSoundButton();
    });

    closeButton.addEventListener('click', closeReelViewer);

    for (const button of stage.querySelectorAll('.rfv-viewer__nav-btn')) {
      button.addEventListener('click', () => stepViewer(Number(button.dataset.step)));
    }

    const seekTo = (clientX) => {
      const rect = progress.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      if (videoEl.duration) videoEl.currentTime = ratio * videoEl.duration;
    };
    progress.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      seekTo(event.clientX);
    });

    viewer.appendChild(stage);

    // Clicking the dimmed backdrop closes; clicking the video itself does not.
    viewer.addEventListener('click', (event) => {
      if (event.target === viewer) closeReelViewer();
    });

    // Scrolling anywhere over the viewer moves this reel on, TikTok-style.
    // The page behind stays scroll-locked so the wheel only drives the reel.
    viewer.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) < 4) return;
        event.preventDefault();
        stepViewer(event.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    let touchStartY = null;
    viewer.addEventListener('touchstart', (event) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    }, { passive: true });

    viewer.addEventListener('touchend', (event) => {
      if (touchStartY === null) return;
      const delta = touchStartY - (event.changedTouches[0]?.clientY ?? touchStartY);
      if (Math.abs(delta) > 50) stepViewer(delta > 0 ? 1 : -1);
      touchStartY = null;
    });

    // Index of the reel on show, so stepping continues from the right place.
    const entry = reels.get(hero);
    state.viewer = {
      hero,
      videoEl,
      stage,
      badge,
      progressFill,
      index: (entry?.baseIndex ?? 0) + state.stepOffset,
      loading: false,
      lastStepAt: 0,
      shownAt: Date.now(),
    };
    updateViewerBadge();
    recordReelShown();

    state.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(viewer);
    document.addEventListener('keydown', onViewerKey, true);

    closeButton.focus();
  }

  async function createBlobUrl(videoUrl) {
    // Ask the background worker to install the declarativeNetRequest rule that
    // rewrites the forbidden request headers (Cookie/Origin/Referer/...) and
    // adds CORS headers. Content scripts can't call chrome.declarativeNetRequest.
    const prepared = await chrome.runtime.sendMessage({ type: 'prepareTikTokVideoFetch' });
    if (prepared?.error) {
      throw new Error(prepared.error);
    }

    // Fetched here rather than in the background worker: the bytes would
    // otherwise cross the extension message boundary, which is JSON-encoded
    // and hard-capped at 64MiB.
    const response = await fetch(videoUrl, {
      method: 'GET',
      headers: { accept: '*/*' },
      credentials: 'omit',
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`TikTok video request failed: ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error('TikTok returned an empty video body');
    }

    recordBytes(blob.size);
    return URL.createObjectURL(blob);
  }

  function getBlobUrl(videoUrl) {
    if (!state.blobUrls.has(videoUrl)) {
      state.blobUrls.set(videoUrl, createBlobUrl(videoUrl));
    }
    return state.blobUrls.get(videoUrl);
  }

  // Pause reels that scroll out of view so a dashboard full of cards doesn't
  // decode every video at once.
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.play().catch(() => {});
        } else {
          entry.target.pause();
        }
      }
    },
    { threshold: 0.1 }
  );

  async function showVideoAt(hero, videoEl, index, isCurrent = () => true) {
    // A resting card stays put until its timer runs out.
    if (isHeroResting(hero)) return;

    // Precedence: locked beats ad beats reel. Locked and ad slots both fetch
    // nothing, so an unpaid or unsold position costs no bandwidth.
    //
    // Keyed on the card's slot from heroSlots, never on the entry's baseIndex:
    // stepViewer rewrites baseIndex as a feed cursor when the expanded player
    // scrolls, so using it here turned paid-for cards into locked ones the
    // next time this ran.
    const slot = heroSlots.get(hero) ?? 0;

    if (isSlotLocked(slot)) {
      videoEl.pause();
      hideAdOverlay(hero);
      showLockOverlay(hero);
      return;
    }

    hideLockOverlay(hero);

    // Ad inventory is decided by position in the feed, not by which card it
    // is — so scrolling past an ad turns that slot back into a reel. No video
    // is fetched while the ad is up.
    if (isAdSlot(index)) {
      videoEl.pause();
      showAdOverlay(hero);
      return;
    }

    hideAdOverlay(hero);
    hero.dataset.rfvReel = 'done';

    const videos = await ensureVideos(index + 1);
    if (!videos.length) return;

    // Only wraps once the feed genuinely has no more reels to hand out.
    const safeIndex = index < videos.length ? index : index % videos.length;
    const blobUrl = await getBlobUrl(videos[safeIndex].videoUrl);

    // A newer step may have landed while this download was in flight.
    if (!hero.isConnected || !isCurrent()) return;

    // Not revoked: blob URLs are cached and shared between cards showing the
    // same reel, so revoking here would break the other cards using it.
    videoEl.src = blobUrl;
    videoEl.load();
    videoEl.play().catch(() => {});
  }

  // Warms the blobs for a block of feed positions so the next press swaps
  // instantly instead of waiting on a download.
  async function prefetchBlock(startIndex, count) {
    const videos = await ensureVideos(startIndex + count).catch(() => null);
    if (!videos?.length) return;

    for (let index = startIndex; index < startIndex + count; index += 1) {
      if (isAdSlot(index)) continue;
      const video = videos[index < videos.length ? index : index % videos.length];
      if (video) getBlobUrl(video.videoUrl).catch(() => {});
    }
  }

  // Deliberately not async: the offset is applied and the cards are kicked off
  // synchronously, so the control stays live. Awaiting every card's download
  // here is what used to grey the button out for the length of N video
  // fetches. The cooldown alone throttles repeat presses.
  function stepAll(step) {
    const now = Date.now();
    // A resting card no longer stops the whole dashboard — only that card is
    // held back, further down.
    if (now - state.lastStepAt < STEP_COOLDOWN_MS) return;

    for (const hero of reels.keys()) {
      if (!hero.isConnected) reels.delete(hero);
    }

    const cardCount = reels.size;
    if (!cardCount) return;

    // Advance by one card per course, so every step hands out a completely
    // fresh block of reels. Stepping by 1 would just shuffle the same reels
    // between neighbouring cards, showing you clips you'd already seen.
    const nextOffset = Math.max(0, state.stepOffset + step * cardCount);
    if (nextOffset === state.stepOffset) return;

    state.lastStepAt = now;
    state.stepOffset = nextOffset;

    // Guards against a slow download from an earlier press landing after a
    // later one and pasting a stale reel onto the card.
    const generation = (state.stepGeneration += 1);
    const isCurrent = () => generation === state.stepGeneration;

    for (const [hero, { videoEl, baseIndex }] of reels) {
      // The resting card keeps its break; stepping past it would hand the user
      // a fresh reel and defeat the point of the break.
      if (isHeroResting(hero)) continue;

      showVideoAt(hero, videoEl, baseIndex + state.stepOffset, isCurrent).catch((error) => {
        console.warn('[reel-fullscreen] Could not load reel:', error.message);
      });
    }

    recordFeedScroll();

    if (step > 0) {
      prefetchBlock(state.stepOffset + cardCount, cardCount);
    }
  }

  function createControl() {
    const control = document.createElement('div');
    control.className = 'rfv-reel-control';

    const label = document.createElement('span');
    label.className = 'rfv-reel-control__label';
    label.textContent = 'Reels';

    const makeButton = (step, text, glyph) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rfv-reel-control__button';
      button.setAttribute('aria-label', text);
      button.title = text;
      button.textContent = glyph;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        stepAll(step);
      });
      return button;
    };

    const soundButton = document.createElement('button');
    soundButton.type = 'button';
    soundButton.className = 'rfv-reel-control__button rfv-reel-control__sound';
    soundButton.textContent = state.muted ? '🔇' : '🔊';
    soundButton.title = state.muted ? 'Unmute reels' : 'Mute reels';
    soundButton.setAttribute('aria-label', soundButton.title);
    soundButton.setAttribute('aria-pressed', String(!state.muted));
    soundButton.addEventListener('click', (event) => {
      event.preventDefault();
      toggleMute();
    });

    const buyButton = document.createElement('button');
    buyButton.type = 'button';
    buyButton.className = 'rfv-reel-control__button rfv-reel-control__buy';
    buyButton.textContent = '＋';
    buyButton.title = 'Buy another reel slot';
    buyButton.setAttribute('aria-label', buyButton.title);
    buyButton.addEventListener('click', (event) => {
      event.preventDefault();
      openShop();
    });

    control.append(
      makeButton(-1, 'Previous reel on every course', '↑'),
      label,
      makeButton(1, 'Next reel on every course', '↓'),
      soundButton,
      buyButton
    );

    control.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) < 4) return;
        event.preventDefault();
        stepAll(event.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    document.body.appendChild(control);
    return control;
  }

  function ensureControl() {
    if (!state.control?.isConnected) {
      state.control = createControl();
    }
    return state.control;
  }

  // Which slots are ad inventory. Hashed rather than random so a Canvas
  // re-render doesn't flip a slot between ad and reel on every repaint, and
  // slot 0 is always a reel — otherwise a single-slot dashboard shows no
  // video at all.
  function isAdSlot(index) {
    if (index <= 0) return false;

    // Rolled once per feed position and remembered. Rolling on every call
    // would re-decide on each Canvas repaint, flickering a slot between ad
    // and reel; memoising keeps a position's outcome fixed once it's drawn,
    // while still being genuinely random rather than a fixed pattern.
    if (!adRolls.has(index)) {
      adRolls.set(index, Math.random() * 100 < AD_SLOT_PERCENT);
    }

    return adRolls.get(index);
  }

  function closeAdSalesDialog() {
    document.querySelector('.rfv-adsale')?.remove();
  }

  function openAdSalesDialog() {
    if (document.querySelector('.rfv-adsale')) return;

    const stats = state.stats;
    const avgDwell = stats.reelsSeen ? stats.playerMs / stats.reelsSeen : 0;

    const dialog = document.createElement('div');
    dialog.className = 'rfv-adsale';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
      <div class="rfv-adsale__panel">
        <p class="rfv-adsale__kicker">Media kit</p>
        <h2 class="rfv-adsale__title">Advertise on this dashboard</h2>
        <p class="rfv-adsale__copy">
          Reach students at the exact moment they open their course list and
          decide not to study.
        </p>

        <dl class="rfv-adsale__metrics">
          <div><dt>Reels served</dt><dd>${stats.reelsSeen.toLocaleString()}</dd></div>
          <div><dt>Scrolls logged</dt><dd>${stats.scrolls.toLocaleString()}</dd></div>
          <div><dt>Avg. attention</dt><dd>${formatDuration(avgDwell)}</dd></div>
          <div><dt>Slots available</dt><dd>${Math.max(0, heroSlots.size - 1)}</dd></div>
        </dl>

        <div class="rfv-adsale__actions">
          <button type="button" class="rfv-adsale__buy">Enquire — from $${AD_DAY_RATE}/day</button>
          <button type="button" class="rfv-adsale__close">Close</button>
        </div>
        <p class="rfv-adsale__note">Demo only — no enquiry is sent and no details are collected.</p>
      </div>
    `;

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeAdSalesDialog();
    });
    dialog.querySelector('.rfv-adsale__close').addEventListener('click', closeAdSalesDialog);
    dialog.querySelector('.rfv-adsale__buy').addEventListener('click', () => {
      const panel = dialog.querySelector('.rfv-adsale__panel');
      panel.innerHTML = `
        <p class="rfv-adsale__kicker">Media kit</p>
        <h2 class="rfv-adsale__title">Thanks — we'll be in touch</h2>
        <p class="rfv-adsale__copy">Nothing was actually sent. This is a demo.</p>
        <div class="rfv-adsale__actions">
          <button type="button" class="rfv-adsale__close">Close</button>
        </div>
      `;
      panel.querySelector('.rfv-adsale__close').addEventListener('click', closeAdSalesDialog);
    });

    document.body.appendChild(dialog);
    dialog.querySelector('.rfv-adsale__buy').focus();
  }

  // An unsold slot advertises itself: the feed's own inventory, for sale.
  // Ads are shown and hidden in place rather than replacing the card's video
  // element, so scrolling past an ad turns the same slot back into a reel
  // without rebuilding the DOM or losing the slot's place in the feed.
  function showAdOverlay(hero) {
    hero.classList.add('rfv-ad-hero');
    hero.dataset.rfvReel = 'ad';

    if (hero.querySelector('.rfv-ad')) return;

    const ad = document.createElement('div');
    ad.className = 'rfv-ad';
    ad.innerHTML = `
      <span class="rfv-ad__tag">Ad space</span>
      <p class="rfv-ad__headline">Your ad could be here</p>
      <p class="rfv-ad__price">From $${AD_DAY_RATE}/day</p>
      <button type="button" class="rfv-ad__cta">Enquire</button>
    `;

    ad.querySelector('.rfv-ad__cta').addEventListener('click', (event) => {
      // The card is wrapped in a link to the course — don't navigate.
      event.preventDefault();
      event.stopPropagation();
      openAdSalesDialog();
    });

    hero.appendChild(ad);
  }

  function hideAdOverlay(hero) {
    hero.classList.remove('rfv-ad-hero');
    hero.querySelector('.rfv-ad')?.remove();
  }

  // A card's lock never moves: the first N slots are the ones paid for, and
  // they stay unlocked no matter how far the feed has scrolled.
  function isSlotLocked(slot) {
    return slot >= state.unlockedSlots;
  }

  function showLockOverlay(hero) {
    hero.classList.add('rfv-locked-hero');
    hero.dataset.rfvReel = 'locked';

    if (hero.querySelector('.rfv-lock')) return;

    const lock = document.createElement('div');
    lock.className = 'rfv-lock';
    // Decorative only — pointer-events are off in CSS so the card's own course
    // link keeps working. Unlocking happens from the floating control.
    lock.setAttribute('aria-hidden', 'true');
    lock.innerHTML = `
      <svg viewBox="0 0 24 24" class="rfv-lock__icon" focusable="false">
        <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Zm0 11a1.5 1.5 0 0 1 .75 2.8V19a.75.75 0 0 1-1.5 0v-1.2A1.5 1.5 0 0 1 12 15Z"/>
      </svg>
      <span class="rfv-lock__label">Locked</span>
    `;

    hero.appendChild(lock);
  }

  function hideLockOverlay(hero) {
    hero.classList.remove('rfv-locked-hero');
    hero.querySelector('.rfv-lock')?.remove();
  }

  // Re-evaluate every card against the current allowance — used after a
  // purchase, when one more card can play.
  function applyUnlocks() {
    pruneDetachedHeroes();

    for (const [hero, { videoEl, baseIndex }] of reels) {
      showVideoAt(hero, videoEl, baseIndex + state.stepOffset).catch(() => {});
    }

    updateControlState();
  }

  function unlockNextSlot() {
    recordSpend(slotPrice(state.unlockedSlots + 1));
    state.unlockedSlots += 1;
    saveUnlockedSlots();
    applyUnlocks();
  }

  function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // Last 7 days including today, oldest first.
  function recentDays(count = 7) {
    const days = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      days.push({
        key,
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        full: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        value: state.stats.dailyScrolls[key] ?? 0,
      });
    }
    return days;
  }

  // Builds the SVG path pair for the rolling window. Coordinates run in a
  // 300x100 viewBox; strokes are non-scaling so stretching keeps them 2px.
  function utilizationPaths() {
    const samples = state.utilization;
    if (!samples.length) return { line: '', area: '' };

    // The y-axis spans full capacity, so the plot reads as "how much of the
    // dashboard is loaded" rather than rescaling every time a slot unlocks.
    const capacity = monitorCapacity();
    const stepX = 300 / Math.max(1, samples.length - 1);
    const points = samples.map((value, index) => [
      index * stepX,
      100 - Math.min(100, (value / capacity) * 100),
    ]);
    const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L300,100 L0,100 Z`;

    return { line, area };
  }

  function renderMonitor(root) {
    const monitor = root.querySelector('.rfv-mon');
    if (!monitor) return;

    const samples = state.utilization;
    const capacity = monitorCapacity();
    const current = samples.at(-1) ?? 0;
    const peak = samples.length ? Math.max(...samples) : 0;
    const average = samples.length
      ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
      : 0;
    const { line, area } = utilizationPaths();

    monitor.querySelector('.rfv-mon__area').setAttribute('d', area);
    monitor.querySelector('.rfv-mon__line').setAttribute('d', line);
    monitor.querySelector('.rfv-mon__value').textContent = `${current}%`;
    monitor.querySelector('.rfv-mon__capacity').textContent = `of ${capacity}%`;
    monitor.querySelector('.rfv-mon__ceiling').textContent = `${capacity}%`;
    monitor.querySelector('.rfv-mon__plot').setAttribute(
      'aria-label',
      `Reel utilisation over the last minute, out of ${capacity} percent capacity. ` +
        `Now ${current} percent, peak ${peak} percent, average ${average} percent.`
    );

    const readouts = {
      active: `${reelsPlaying()}/${reels.size || 0}`,
      peak: `${peak}%`,
      average: `${average}%`,
      rate: `${scrollsPerMinute()}/min`,
      streamed: formatBytes(state.stats.bytes),
      uptime: formatDuration(Date.now() - state.sessionStart),
    };

    for (const [key, value] of Object.entries(readouts)) {
      const cell = monitor.querySelector(`[data-readout="${key}"]`);
      if (cell) cell.textContent = value;
    }
  }

  function monitorMarkup() {
    return `
      <section class="rfv-mon">
        <div class="rfv-mon__head">
          <h3 class="rfv-mon__title">Reel utilisation</h3>
          <p class="rfv-mon__reading">
            <span class="rfv-mon__value">0%</span>
            <span class="rfv-mon__capacity">of 100%</span>
          </p>
        </div>

        <div class="rfv-mon__plot-wrap">
          <span class="rfv-mon__ceiling">100%</span>
          <svg class="rfv-mon__plot" viewBox="0 0 300 100" preserveAspectRatio="none"
               role="img" aria-label="Reel utilisation over the last minute">
            <g class="rfv-mon__grid">
              <line x1="0" y1="25" x2="300" y2="25" />
              <line x1="0" y1="50" x2="300" y2="50" />
              <line x1="0" y1="75" x2="300" y2="75" />
            </g>
            <path class="rfv-mon__area" d="" />
            <path class="rfv-mon__line" d="" vector-effect="non-scaling-stroke" />
          </svg>
          <div class="rfv-mon__crosshair" hidden></div>
          <div class="rfv-mon__tip" hidden></div>
          <span class="rfv-mon__axis rfv-mon__axis--start">60s ago</span>
          <span class="rfv-mon__axis rfv-mon__axis--end">now</span>
        </div>

        <dl class="rfv-mon__readouts">
          <div><dt>Reels playing</dt><dd data-readout="active">0/0</dd></div>
          <div><dt>Peak</dt><dd data-readout="peak">0%</dd></div>
          <div><dt>Average</dt><dd data-readout="average">0%</dd></div>
          <div><dt>Scroll rate</dt><dd data-readout="rate">0/min</dd></div>
          <div><dt>Streamed</dt><dd data-readout="streamed">0 KB</dd></div>
          <div><dt>Session</dt><dd data-readout="uptime">0s</dd></div>
        </dl>
      </section>
    `;
  }

  function wireMonitorHover(root) {
    const wrap = root.querySelector('.rfv-mon__plot-wrap');
    const crosshair = root.querySelector('.rfv-mon__crosshair');
    const tip = root.querySelector('.rfv-mon__tip');
    if (!wrap) return;

    wrap.addEventListener('mousemove', (event) => {
      const rect = wrap.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const index = Math.round(ratio * (state.utilization.length - 1));
      const value = state.utilization[index] ?? 0;
      const secondsAgo = state.utilization.length - 1 - index;

      crosshair.hidden = false;
      crosshair.style.left = `${ratio * 100}%`;
      tip.hidden = false;
      tip.textContent = `${secondsAgo === 0 ? 'now' : `${secondsAgo}s ago`} · ${value}% of ${monitorCapacity()}%`;
      tip.style.left = `${ratio * 100}%`;
    });

    wrap.addEventListener('mouseleave', () => {
      crosshair.hidden = true;
      tip.hidden = true;
    });
  }

  function closeStatsPanel() {
    const panel = document.querySelector('.rfv-stats');
    if (panel?.dataset.timer) {
      window.clearInterval(Number(panel.dataset.timer));
    }
    panel?.remove();
  }

  function openStatsPanel() {
    if (document.querySelector('.rfv-stats')) return;

    const stats = state.stats;
    // Efficiency = reels actually watched, out of every reel put in front of
    // you. Deliberately not "scrolls per minute" — speed isn't the thing worth
    // measuring here.
    const efficiency = stats.reelsSeen ? Math.round((stats.engaged / stats.reelsSeen) * 100) : 0;
    const avgPerReel = stats.reelsSeen ? stats.playerMs / stats.reelsSeen : 0;
    const days = recentDays();
    const peak = Math.max(1, ...days.map((day) => day.value));
    const daysTracked = Math.max(1, Math.ceil((Date.now() - stats.firstSeen) / 86400000));

    const tiles = [
      { label: 'Reels scrolled', value: stats.scrolls.toLocaleString(), foot: `${(stats.scrolls / daysTracked).toFixed(1)} per day` },
      { label: 'Time in player', value: formatDuration(stats.playerMs), foot: `${formatDuration(avgPerReel)} per reel` },
      { label: 'Video downloaded', value: formatBytes(stats.bytes), foot: `${stats.reelsSeen} reels loaded` },
      { label: 'Screen breaks', value: String(stats.breaks), foot: stats.breaks ? 'eyes rested' : 'none yet' },
      { label: 'Slots unlocked', value: `${state.unlockedSlots}`, foot: `$${stats.spend.toFixed(2)} simulated` },
      { label: 'Watched ≥3s', value: `${stats.engaged}`, foot: `of ${stats.reelsSeen} shown` },
    ];

    const panel = document.createElement('div');
    panel.className = 'rfv-stats';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Reel stats');

    panel.innerHTML = `
      <div class="rfv-stats__panel viz-root">
        <div class="rfv-stats__head">
          <div>
            <p class="rfv-stats__kicker">Reel analytics</p>
            <h2 class="rfv-stats__title">Your scrolling, measured</h2>
          </div>
          <button type="button" class="rfv-stats__close" title="Close" aria-label="Close stats">✕</button>
        </div>

        ${monitorMarkup()}

        <section class="rfv-stats__hero">
          <p class="rfv-stats__hero-label">Scroll efficiency</p>
          <p class="rfv-stats__hero-value">${efficiency}<span class="rfv-stats__hero-unit">%</span></p>
          <div class="rfv-stats__meter" role="img"
               aria-label="Scroll efficiency ${efficiency} percent: ${stats.engaged} of ${stats.reelsSeen} reels watched for at least three seconds">
            <div class="rfv-stats__meter-fill" style="width:${efficiency}%"></div>
          </div>
          <p class="rfv-stats__hero-foot">
            Reels you actually watched (3s or more), out of every reel put in front of you.
          </p>
        </section>

        <section class="rfv-stats__tiles">
          ${tiles
            .map(
              (tile) => `
            <div class="rfv-stats__tile">
              <p class="rfv-stats__tile-label">${tile.label}</p>
              <p class="rfv-stats__tile-value">${tile.value}</p>
              <p class="rfv-stats__tile-foot">${tile.foot}</p>
            </div>`
            )
            .join('')}
        </section>

        <section class="rfv-stats__chart-block">
          <div class="rfv-stats__chart-head">
            <h3 class="rfv-stats__chart-title">Reels scrolled per day</h3>
            <button type="button" class="rfv-stats__table-toggle" aria-expanded="false">Table</button>
          </div>

          <div class="rfv-stats__chart">
            ${days
              .map(
                (day) => `
              <div class="rfv-stats__bar-col" tabindex="0"
                   aria-label="${day.full}: ${day.value} reels"
                   data-label="${day.full}" data-value="${day.value}">
                ${day.value === peak && day.value > 0 ? `<span class="rfv-stats__bar-value">${day.value}</span>` : ''}
                <div class="rfv-stats__bar" style="height:${(day.value / peak) * 100}%"></div>
                <span class="rfv-stats__bar-label">${day.label}</span>
              </div>`
              )
              .join('')}
            <div class="rfv-stats__tooltip" hidden></div>
          </div>

          <table class="rfv-stats__table" hidden>
            <caption class="rfv-stats__sr">Reels scrolled per day</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Reels</th></tr></thead>
            <tbody>
              ${days.map((day) => `<tr><th scope="row">${day.full}</th><td>${day.value}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>
      </div>
    `;

    panel.addEventListener('click', (event) => {
      if (event.target === panel) closeStatsPanel();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeStatsPanel();
    });
    panel.querySelector('.rfv-stats__close').addEventListener('click', closeStatsPanel);

    // Table view, so the figures are readable without relying on the bars.
    const table = panel.querySelector('.rfv-stats__table');
    const toggle = panel.querySelector('.rfv-stats__table-toggle');
    toggle.addEventListener('click', () => {
      const showing = table.hasAttribute('hidden');
      table.toggleAttribute('hidden', !showing);
      toggle.setAttribute('aria-expanded', String(showing));
      toggle.textContent = showing ? 'Chart' : 'Table';
    });

    // Per-bar hover/focus readout.
    const tooltip = panel.querySelector('.rfv-stats__tooltip');
    for (const column of panel.querySelectorAll('.rfv-stats__bar-col')) {
      const show = () => {
        tooltip.textContent = `${column.dataset.label} · ${column.dataset.value} reels`;
        tooltip.hidden = false;
        tooltip.style.left = `${column.offsetLeft + column.offsetWidth / 2}px`;
      };
      const hide = () => {
        tooltip.hidden = true;
      };
      column.addEventListener('mouseenter', show);
      column.addEventListener('focus', show);
      column.addEventListener('mouseleave', hide);
      column.addEventListener('blur', hide);
    }

    document.body.appendChild(panel);

    // The monitor keeps ticking while the panel is open; the sampler behind it
    // runs regardless, so the window already holds a minute of history.
    renderMonitor(panel);
    wireMonitorHover(panel);
    panel.dataset.timer = String(window.setInterval(() => renderMonitor(panel), MONITOR_INTERVAL_MS));

    panel.querySelector('.rfv-stats__close').focus();
  }

  // Adds a "Reel Stats" entry to Canvas's global nav, matching its own markup
  // so it inherits the sidebar styling.
  function injectNavTab() {
    const menu = document.getElementById('menu');
    if (!menu || document.getElementById('rfv_stats_nav')) return;

    const item = document.createElement('li');
    item.className = 'menu-item ic-app-header__menu-list-item';
    item.innerHTML = `
      <a id="rfv_stats_nav" role="button" href="#" class="ic-app-header__menu-list-link">
        <div class="menu-item-icon-container" aria-hidden="true">
          <svg class="ic-icon-svg menu-item__icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 20h16v2H2V2h2v18Zm3-3V9h3v8H7Zm5.5 0V4h3v13h-3ZM18 17v-6h3v6h-3Z"/>
          </svg>
        </div>
        <div class="menu-item__text">Reel Stats</div>
      </a>
    `;

    item.querySelector('a').addEventListener('click', (event) => {
      event.preventDefault();
      openStatsPanel();
    });

    menu.appendChild(item);
  }

  function closeShop() {
    document.querySelector('.rfv-shop')?.remove();
  }

  function openShop() {
    if (document.querySelector('.rfv-shop')) return;

    const totalSlots = heroSlots.size;
    const allUnlocked = state.unlockedSlots >= totalSlots;
    const nextSlot = state.unlockedSlots + 1;

    const shop = document.createElement('div');
    shop.className = 'rfv-shop';
    shop.setAttribute('role', 'dialog');
    shop.setAttribute('aria-modal', 'true');
    shop.innerHTML = `
      <div class="rfv-shop__panel">
        <p class="rfv-shop__kicker">Reel slots</p>
        <h2 class="rfv-shop__title">${allUnlocked ? 'Every slot is unlocked' : `Unlock slot ${nextSlot}`}</h2>
        <p class="rfv-shop__copy">
          ${allUnlocked
            ? `All ${totalSlots} course cards are already playing reels.`
            : `You have ${state.unlockedSlots} of ${totalSlots} slots. Unlocking adds a reel to one more course card.`}
        </p>
        <div class="rfv-shop__actions">
          ${allUnlocked ? '' : `<button type="button" class="rfv-shop__buy">Buy for $${slotPrice(nextSlot)}</button>`}
          <button type="button" class="rfv-shop__close">${allUnlocked ? 'Close' : 'Maybe later'}</button>
        </div>
        <p class="rfv-shop__note">Demo only — no payment is taken and no details are collected.</p>
      </div>
    `;

    shop.addEventListener('click', (event) => {
      if (event.target === shop) closeShop();
    });
    shop.querySelector('.rfv-shop__close').addEventListener('click', closeShop);
    shop.querySelector('.rfv-shop__buy')?.addEventListener('click', () => {
      unlockNextSlot();
      closeShop();
    });

    document.body.appendChild(shop);
  }

  function updateControlState() {
    const buyButton = state.control?.querySelector('.rfv-reel-control__buy');
    if (!buyButton) return;

    const allUnlocked = state.unlockedSlots >= heroSlots.size;
    buyButton.textContent = allUnlocked ? '★' : '＋';
    buyButton.title = allUnlocked ? 'All reel slots unlocked' : 'Buy another reel slot';
    buyButton.setAttribute('aria-label', buyButton.title);
  }

  async function attachReel(hero, index) {
    if (hero.dataset.rfvReel) return;
    heroSlots.set(hero, index);
    hero.dataset.rfvReel = 'pending';

    try {
      // baseIndex is absolute, not wrapped: each card owns its own slot in the
      // pool so no two cards ever land on the same reel.
      const baseIndex = index;
      const targetIndex = baseIndex + state.stepOffset;

      // The card may have been re-rendered by Canvas since the scan.
      if (!hero.isConnected) {
        hero.dataset.rfvReel = '';
        return;
      }

      // The video element is built even for an ad slot: ads hide it rather
      // than replace it, so scrolling on turns the same card back into a reel
      // without rebuilding anything.
      const videoEl = document.createElement('video');
      videoEl.className = 'rfv-reel-video';
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = shouldMuteNow();
      videoEl.volume = 1;
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', 'true');
      videoEl.setAttribute('webkit-playsinline', 'true');

      // The banner opens the reel; the card's title still links to the course.
      videoEl.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Remembered so a break lands on the card the user actually watched.
        state.lastWatchedHero = hero;
        openReelViewer(hero, videoEl);
      });

      // Only add positioning if Canvas hasn't already positioned the hero
      // itself (it does in the __header_image variant, to overlay the image).
      if (getComputedStyle(hero).position === 'static') {
        hero.style.position = 'relative';
      }

      hero.classList.add('rfv-reel-hero');
      hero.closest('.ic-DashboardCard__header')?.classList.add('rfv-has-reel');
      hero.appendChild(videoEl);
      visibilityObserver.observe(videoEl);

      // Registered before the first paint so the scroll controls can advance
      // this card even while it is currently showing an ad.
      reels.set(hero, { videoEl, baseIndex });
      ensureControl();
      updateControlState();

      // Reinstate a break this card was serving before the page reloaded, so
      // showVideoAt below leaves it resting instead of resuming playback.
      restoreBreakFor(hero);

      // Decides ad vs reel for this feed position and loads accordingly.
      await showVideoAt(hero, videoEl, targetIndex);
    } catch (error) {
      hero.dataset.rfvReel = 'error';
      // Every card fails for the same reason, so only report the first one.
      if (!state.reportedError) {
        state.reportedError = true;
        console.error('[reel-fullscreen] Could not attach reels to dashboard cards:', error.message);
      }
    }
  }

  // A stable identity for the course a hero belongs to. Canvas re-renders the
  // dashboard, destroying and rebuilding the card DOM, so the element itself
  // can't be used to remember which slot a course was given.
  function courseKeyFor(hero) {
    const card = hero.closest('.ic-DashboardCard');
    return (
      card?.querySelector('.ic-DashboardCard__link')?.getAttribute('href') ||
      card?.getAttribute('aria-label') ||
      null
    );
  }

  // Drop heroes Canvas has replaced, so slot totals reflect the cards actually
  // on screen rather than every card ever rendered.
  function pruneDetachedHeroes() {
    for (const hero of heroSlots.keys()) {
      if (!hero.isConnected) heroSlots.delete(hero);
    }
    for (const hero of reels.keys()) {
      if (!hero.isConnected) reels.delete(hero);
    }
  }

  function scanForHeroes() {
    state.scanQueued = false;
    // The nav and banner exist on every Canvas page, not just the dashboard.
    injectNavTab();
    refreshPromoBanner();
    pruneDetachedHeroes();

    const heroes = [...document.querySelectorAll(HERO_SELECTOR)];

    let attachedAny = false;
    heroes.forEach((hero, position) => {
      if (hero.dataset.rfvReel) return;
      attachReel(hero, slotFor(hero, position));
      attachedAny = true;
    });

    // Each card decides lock-vs-ad-vs-reel the moment it attaches, when the
    // reels map may still be half-populated — so the allowance would be drawn
    // against the wrong card count. Re-run once the scan has registered
    // everyone. Blobs are cached, so this costs no extra downloads.
    if (attachedAny) {
      requestAnimationFrame(() => applyUnlocks());
    }
  }

  // A course keeps the same slot number for good: it's stored, so an unlocked
  // course stays unlocked across reloads even if Canvas reorders the cards.
  // A running counter or bare DOM position would reassign on every render.
  function slotFor(hero, position) {
    const key = courseKeyFor(hero);
    if (!key) return position;

    const existing = slotByCourse.get(key);
    if (Number.isInteger(existing)) return existing;

    // New course: prefer its position, but never collide with a slot already
    // promised to another course.
    const taken = new Set(slotByCourse.values());
    let slot = position;
    while (taken.has(slot)) slot += 1;

    slotByCourse.set(key, slot);
    saveSlotAssignments();
    return slot;
  }

  function queueScan() {
    if (state.scanQueued) return;
    state.scanQueued = true;
    requestAnimationFrame(scanForHeroes);
  }

  async function start() {
    // isLmsSite is async — without the await this tests a Promise, which is
    // always truthy, so the guard would never actually block.
    if (window.top !== window.self || !(await isLmsSite())) return;

    // Must resolve before the first scan, otherwise cards get locked against
    // the default of 1 rather than what was actually unlocked.
    await loadSettings();
    primeAudioOnFirstGesture();
    startUtilizationSampling();

    queueScan();

    // Canvas renders the dashboard with React, so cards can appear (or be
    // swapped out on dashboard-view changes) well after document_idle.
    new MutationObserver(queueScan).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
