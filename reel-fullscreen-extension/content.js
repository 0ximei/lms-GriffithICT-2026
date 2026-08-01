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
    advancing: false,
    lastStepAt: 0,
    breakOverlay: null,
    breakTimer: null,
    scrollsSinceBreak: 0,
    scrollsBeforeBreak: randomInteger(MIN_SCROLLS_BETWEEN_BREAKS, MAX_SCROLLS_BETWEEN_BREAKS),
    unlockedSlots: DEFAULT_UNLOCKED_SLOTS,
  };

  // hero element -> { videoEl, baseIndex }
  const reels = new Map();
  // Every hero we've seen -> its slot number, locked or not, so slots can be
  // filled in later when one is unlocked.
  const heroSlots = new Map();
  // course href -> slot number, so a course keeps its slot across the DOM
  // rebuilds Canvas does when it re-renders the dashboard.
  const slotByCourse = new Map();

  async function loadUnlockedSlots() {
    try {
      const stored = await chrome.storage.local.get({ [SLOTS_STORAGE_KEY]: DEFAULT_UNLOCKED_SLOTS });
      state.unlockedSlots = Math.max(DEFAULT_UNLOCKED_SLOTS, Number(stored[SLOTS_STORAGE_KEY]) || DEFAULT_UNLOCKED_SLOTS);
    } catch {
      state.unlockedSlots = DEFAULT_UNLOCKED_SLOTS;
    }
  }

  function saveUnlockedSlots() {
    chrome.storage.local.set({ [SLOTS_STORAGE_KEY]: state.unlockedSlots }).catch(() => {});
  }

  function formatCountdown(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  function clearEyeBreak() {
    if (state.breakTimer) {
      window.clearInterval(state.breakTimer);
      state.breakTimer = null;
    }
    state.breakOverlay?.remove();
    state.breakOverlay = null;
  }

  function startEyeBreak() {
    if (state.breakOverlay || !document.body) return;

    const duration = randomInteger(MIN_BREAK_SECONDS, MAX_BREAK_SECONDS);
    const endsAt = Date.now() + duration * 1000;
    const breakOverlay = document.createElement('section');
    breakOverlay.className = 'rfv-eye-break';
    breakOverlay.setAttribute('role', 'dialog');
    breakOverlay.setAttribute('aria-modal', 'true');
    breakOverlay.setAttribute('aria-labelledby', 'rfv-eye-break-title');
    breakOverlay.innerHTML = `
      <div class="rfv-eye-break-content">
        <p class="rfv-eye-break-kicker">Screen break</p>
        <h2 id="rfv-eye-break-title">Look away from your screen</h2>
        <div class="rfv-eye-break-timer" role="timer" aria-label="Break time remaining">
          <span class="rfv-eye-break-countdown">${formatCountdown(duration)}</span>
        </div>
        <p class="rfv-eye-break-copy">Give your eyes a moment to rest.</p>
      </div>
    `;

    const countdown = breakOverlay.querySelector('.rfv-eye-break-countdown');
    const timer = breakOverlay.querySelector('.rfv-eye-break-timer');
    const preventScroll = (event) => event.preventDefault();
    breakOverlay.addEventListener('wheel', preventScroll, { passive: false });
    breakOverlay.addEventListener('touchmove', preventScroll, { passive: false });
    document.body.appendChild(breakOverlay);
    state.breakOverlay = breakOverlay;

    function updateTimer() {
      const secondsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      countdown.textContent = formatCountdown(secondsLeft);
      timer.style.setProperty('--rfv-break-progress', String(secondsLeft / duration));

      if (secondsLeft === 0) {
        clearEyeBreak();
        state.scrollsSinceBreak = 0;
        state.scrollsBeforeBreak = randomInteger(MIN_SCROLLS_BETWEEN_BREAKS, MAX_SCROLLS_BETWEEN_BREAKS);
      }
    }

    updateTimer();
    state.breakTimer = window.setInterval(updateTimer, 250);
  }

  function recordFeedScroll() {
    if (state.breakOverlay) return;
    state.scrollsSinceBreak += 1;
    if (state.scrollsSinceBreak >= state.scrollsBeforeBreak) {
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
    state.fetchChain = (state.fetchChain ?? Promise.resolve()).then(() => fillTo(minCount));
    return state.fetchChain;
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

  async function showVideoAt(hero, videoEl, index) {
    const videos = await ensureVideos(index + 1);
    if (!videos.length) return;

    // Only wraps once the feed genuinely has no more reels to hand out.
    const safeIndex = index < videos.length ? index : index % videos.length;
    const blobUrl = await getBlobUrl(videos[safeIndex].videoUrl);

    if (!hero.isConnected) return;

    // Not revoked: blob URLs are cached and shared between cards showing the
    // same reel, so revoking here would break the other cards using it.
    videoEl.src = blobUrl;
    videoEl.load();
    videoEl.play().catch(() => {});
  }

  async function stepAll(step) {
    const now = Date.now();
    // One wheel gesture emits a burst of events, and cached reels resolve
    // instantly, so without a cooldown a single flick would skip many reels.
    if (state.advancing || state.breakOverlay || now - state.lastStepAt < STEP_COOLDOWN_MS) return;

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

    state.advancing = true;
    state.lastStepAt = now;
    state.control?.classList.add('rfv-reel-control--busy');

    try {
      state.stepOffset = nextOffset;

      await Promise.all(
        Array.from(reels, ([hero, { videoEl, baseIndex }]) =>
          showVideoAt(hero, videoEl, baseIndex + state.stepOffset).catch((error) => {
            console.warn('[reel-fullscreen] Could not load reel:', error.message);
          })
        )
      );
    } finally {
      state.advancing = false;
      state.control?.classList.remove('rfv-reel-control--busy');
    }

    recordFeedScroll();

    // Pull the batch after this one now, so the next step doesn't stall on a
    // round trip to TIKTOK_API_URL.
    if (step > 0) {
      ensureVideos(state.stepOffset + cardCount * 2).catch(() => {});
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

  function renderLockedHero(hero, index) {
    hero.classList.add('rfv-reel-hero', 'rfv-locked-hero');
    hero.closest('.ic-DashboardCard__header')?.classList.add('rfv-has-reel');

    if (getComputedStyle(hero).position === 'static') {
      hero.style.position = 'relative';
    }

    const lock = document.createElement('div');
    lock.className = 'rfv-lock';
    // Decorative only — pointer-events are off in CSS so the card's own course
    // link keeps working. Unlocking happens from the floating control.
    lock.setAttribute('aria-hidden', 'true');
    lock.innerHTML = `
      <svg viewBox="0 0 24 24" class="rfv-lock__icon" focusable="false">
        <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Zm0 11a1.5 1.5 0 0 1 .75 2.8V19a.75.75 0 0 1-1.5 0v-1.2A1.5 1.5 0 0 1 12 15Z"/>
      </svg>
      <span class="rfv-lock__label">Slot ${index + 1} locked</span>
    `;

    hero.appendChild(lock);
    hero.dataset.rfvReel = 'locked';
  }

  // Fill any slots that have become unlocked since the cards were rendered.
  function applyUnlocks() {
    pruneDetachedHeroes();

    for (const [hero, index] of heroSlots) {
      if (hero.dataset.rfvReel !== 'locked' || index >= state.unlockedSlots) continue;

      hero.querySelector('.rfv-lock')?.remove();
      hero.classList.remove('rfv-locked-hero');
      hero.dataset.rfvReel = '';
      attachReel(hero, index);
    }
    updateControlState();
  }

  function unlockNextSlot() {
    state.unlockedSlots += 1;
    saveUnlockedSlots();
    applyUnlocks();
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

    // Locked slots show a padlock instead of downloading a reel.
    if (index >= state.unlockedSlots) {
      renderLockedHero(hero, index);
      ensureControl();
      updateControlState();
      return;
    }

    hero.dataset.rfvReel = 'pending';

    try {
      // baseIndex is absolute, not wrapped: each card owns its own slot in the
      // pool so no two cards ever land on the same reel.
      const baseIndex = index;
      const targetIndex = baseIndex + state.stepOffset;

      const videos = await ensureVideos(targetIndex + 1);
      if (!videos.length) {
        throw new Error('No TikTok videos returned');
      }

      const safeIndex = targetIndex < videos.length ? targetIndex : targetIndex % videos.length;
      const blobUrl = await getBlobUrl(videos[safeIndex].videoUrl);

      // The card may have been re-rendered by Canvas while we were fetching.
      if (!hero.isConnected) {
        hero.dataset.rfvReel = '';
        return;
      }

      const videoEl = document.createElement('video');
      videoEl.className = 'rfv-reel-video';
      videoEl.src = blobUrl;
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', 'true');
      videoEl.setAttribute('webkit-playsinline', 'true');

      // Only add positioning if Canvas hasn't already positioned the hero
      // itself (it does in the __header_image variant, to overlay the image).
      if (getComputedStyle(hero).position === 'static') {
        hero.style.position = 'relative';
      }

      hero.classList.add('rfv-reel-hero');
      hero.closest('.ic-DashboardCard__header')?.classList.add('rfv-has-reel');
      hero.appendChild(videoEl);
      visibilityObserver.observe(videoEl);
      videoEl.play().catch(() => {});

      reels.set(hero, { videoEl, baseIndex });
      ensureControl();
      updateControlState();

      hero.dataset.rfvReel = 'done';
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
    pruneDetachedHeroes();

    const heroes = [...document.querySelectorAll(HERO_SELECTOR)];

    heroes.forEach((hero, position) => {
      if (hero.dataset.rfvReel) return;

      // Slot follows the card's position on the dashboard, remembered per
      // course. Using a running counter meant every Canvas re-render handed
      // out fresh, ever-higher numbers, so no card was ever slot 0.
      const key = courseKeyFor(hero);
      let slot = position;

      if (key) {
        if (!slotByCourse.has(key)) slotByCourse.set(key, position);
        slot = slotByCourse.get(key);
      }

      attachReel(hero, slot);
    });
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
    await loadUnlockedSlots();

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
