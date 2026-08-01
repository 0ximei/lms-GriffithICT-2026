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

  const state = {
    // Accumulated pool of unique reels. Stepping pulls further into this list
    // rather than wrapping, so a card never repeats a reel already shown.
    videos: [],
    currentIndex: 0,
    loading: false,
    breakOverlay: null,
    breakTimer: null,
    scrollsSinceBreak: 0,
    scrollsBeforeBreak: randomInteger(MIN_SCROLLS_BETWEEN_BREAKS, MAX_SCROLLS_BETWEEN_BREAKS),
  };

  function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

  function removeOverlay() {
    clearEyeBreak();
    const overlay = document.getElementById('rfv-tiktok-overlay');
    if (overlay) {
      overlay.remove();
      document.body.style.overflow = '';
    }
    state.overlay = null;
    state.frameWrap = null;
    state.videoEl = null;
    state.videos = [];
    state.currentIndex = 0;
    state.loading = false;
  }

  async function setVideoSource(video) {
    if (!state.videoEl || !video?.videoUrl) return;

    try {
      // Ask the background worker to install the declarativeNetRequest rule
      // that rewrites the forbidden request headers (Cookie/Origin/Referer/...)
      // and adds CORS headers to the response. Content scripts can't call
      // chrome.declarativeNetRequest themselves.
      const prepared = await chrome.runtime.sendMessage({ type: 'prepareTikTokVideoFetch' });
      if (prepared?.error) {
        throw new Error(prepared.error);
      }

      // Fetch here rather than in the background worker: the bytes would
      // otherwise have to cross the extension message boundary, which is
      // JSON-encoded and hard-capped at 64MiB.
      const response = await fetch(video.videoUrl, {
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

      const blobUrl = URL.createObjectURL(blob);

      if (state.videoEl.src && state.videoEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(state.videoEl.src);
      }

      state.videoEl.src = blobUrl;
      state.videoEl.load();
      state.videoEl.play().catch(() => {});
    } catch (error) {
      if (state.frameWrap) {
        state.frameWrap.innerHTML = '';
        const fallback = document.createElement('div');
        fallback.className = 'rfv-tiktok-error';
        fallback.textContent = error.message || 'Unable to load TikTok video right now.';
        state.frameWrap.appendChild(fallback);
      }
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


  async function loadVideoByDirection(direction = 1) {
    if (state.loading || state.breakOverlay) return false;
    state.loading = true;

    try {
      state.stepOffset = nextOffset;

      const targetIndex = state.currentIndex + direction;
      if (targetIndex < 0) {
        state.currentIndex = 0;
      } else if (targetIndex >= state.videos.length) {
        const moreVideos = await fetchTikTokVideos();
        if (moreVideos.length) {
          state.videos = state.videos.concat(moreVideos);
          state.currentIndex = targetIndex;
        } else {
          state.currentIndex = Math.max(0, state.videos.length - 1);
        }
      } else {
        state.currentIndex = targetIndex;
      }

      const video = state.videos[state.currentIndex];
      if (!video?.videoUrl) {
        throw new Error('No TikTok video url returned');
      }
      await setVideoSource(video);
      return true;
    } catch (error) {
      if (state.frameWrap) {
        state.frameWrap.innerHTML = '';
        const fallback = document.createElement('div');
        fallback.className = 'rfv-tiktok-error';
        fallback.textContent = error.message || 'Unable to load TikTok video right now.';
        state.frameWrap.appendChild(fallback);
      }
      return false;
    } finally {
      state.advancing = false;
      state.control?.classList.remove('rfv-reel-control--busy');
    }

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

    control.append(
      makeButton(-1, 'Previous reel on every course', '↑'),
      label,
      makeButton(1, 'Next reel on every course', '↓')
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

  async function attachReel(hero, index) {
    if (hero.dataset.rfvReel) return;
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

  function scanForHeroes() {
    state.scanQueued = false;

    for (const hero of document.querySelectorAll(HERO_SELECTOR)) {
      if (hero.dataset.rfvReel) continue;
      attachReel(hero, state.attachedCount);
      state.attachedCount += 1;
    }
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
