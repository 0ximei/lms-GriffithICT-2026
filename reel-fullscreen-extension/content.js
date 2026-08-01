(() => {
  if (window.__rfvTikTokOverlayInjected) return;
  window.__rfvTikTokOverlayInjected = true;

  const TIKTOK_API_URL = 'https://www.tiktok.com/api/recommend/item_list/?WebIdLastTime=1785549349&aid=1988&app_language=en-GB&app_name=tiktok_web&browser_language=en-AU&browser_name=Mozilla&browser_online=true&browser_platform=MacIntel&browser_version=5.0%20%28Macintosh%3B%20Intel%20Mac%20OS%20X%2010_15_7%29%20AppleWebKit%2F537.36%20%28KHTML%2C%20like%20Gecko%29%20Chrome%2F149.0.0.0%20Safari%2F537.36&channel=tiktok_web&clientABVersions=70508271%2C73720540%2C76124482%2C76314874%2C76378881%2C76388334%2C76406767%2C76424652%2C76432883%2C76463665%2C76484018%2C76523579%2C76581986%2C76600397%2C76604747%2C76612495%2C76615284%2C76622812%2C76689044%2C76702428%2C70405643%2C71057832%2C71200802%2C73171280%2C73208420%2C74008524%2C74276218%2C74413136%2C74844724%2C75330961&cookie_enabled=true&count=12&cpu_core_number=8&dark_mode=false&data_collection_enabled=true&day_of_week=6&device_id=7668876046959642129&device_platform=web_pc&device_score=8.12&device_type=web_h265&enable_cache=false&focus_state=false&from_page=fyp&history_len=2&isNonPersonalized=false&is_fullscreen=true&is_new_user=true&is_page_visible=true&itemID=&language=en&launch_mode=direct&network=1.4&odinId=7668876928619004946&os=mac&priority_region=&pullType=2&referer=&region=JP&screen_height=1169&screen_width=1800&showAboutThisAd=true&showAds=false&time_of_day=12&tz_name=Australia%2FBrisbane&video_encoding=dash&vv_count=16&vv_count_fyp=16&watchLiveLastTime=&webcast_language=en-GB&window_height=1042&window_width=1245&X-Dynosaur=MxapVm4WZWeZ9lCM9iBsrZIdOqVtsXUqRWnixyzCChZ-uXNODWITHb2hBd5ijQpWt37UU5MoPQKvjQb5Tty2/7yeC-6RCIi/6IrbEGH017fec4g9r5AccKzt/EyMhtQhQgtliJBEz55hFe-9c645jQev6u2Knf1Wt-kTpgZ6mUlGLzjA7hSkK8v-nbLngSfQ1x2ZDeQoJI/VjHx2pTmfuLOjs3zmTV3FqSxj9AWEZQKqdJfYQiNHyddrKViF014ahK9Rumlqc6/kpzhqt3YD4ub9NCUVsjOQDWJazAr3vJgdU9Do3kim2wGatsUguVe1/Bfo9lor5yE-HxmllMxlKH2kTj7RKcmcyTbtYZo8OG0w2QNWc9Lp5oQpqa/J3xUUXUwqoc1d9COYin/jw58RnqYJv-hA4mxqVwV0PJc4tjML1g7GZuPlJ6KJAy3Y&msToken=EZ7GcZKgO3GJE2suDsN8XyQQD5wiLgK8iXpNIpfCu3hZmxIk2Bc3tp_FxyXy7ER07A5pQM8xTl2roatOS3n2peHmoX6VpJJ7Q359zV7DPmUUhZzLqxmpVOOaWiLF6KHeA8ebZjuSsBQ0O6NaHsEJBukv8eywB2PPoQOtUUIwOg==&X-Bogus=1&X-Gnarly=Mwg1EoLEOzDEQXUNOxErUkmo/DIUIB5a7ejuydy2a7vs6x-eFaU4wc-npTcmhBzZvIQ6phmuuK6aTAOArKnRqtV1DtLdfWI7iurz5/vK22NbNDToyh6RzDYi5vzf/QR6MI08L--eVWODuOUAjonxGgGbdm2siowEhy4GA6MohVu8vRWXt/-f5aSHv9xdUCHQA7bP563MMGswuXQ8y7v1e3I74xTc7id-tFjI0a2KTwnFvDlawbbil95PBSRdoqwiHxNmBADcZQarw8a3c6padH0itRjD2sMrSl5Tz5Nvjxv0V8ZWG3HlX5D5RZ-vzrkD6M1Amwcnq3V1';

  function isLmsSite() {
    return /(^|\.)griffith\.edu\.au$/.test(location.hostname);
  }

  const MIN_SCROLLS_BETWEEN_BREAKS = 2;
  const MAX_SCROLLS_BETWEEN_BREAKS = 10;
  const MIN_BREAK_SECONDS = 40;
  const MAX_BREAK_SECONDS = 5 * 60;

  const state = {
    overlay: null,
    frameWrap: null,
    videoEl: null,
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
    return Array.isArray(response?.videos)
      ? response.videos.filter(Boolean)
      : [];
  }

  async function loadVideoByDirection(direction = 1) {
    if (state.loading || state.breakOverlay) return false;
    state.loading = true;

    try {
      if (!state.videos.length) {
        const videos = await fetchTikTokVideos();
        if (!videos.length) {
          throw new Error('No TikTok videos returned');
        }
        state.videos = videos;
        state.currentIndex = 0;
      }

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
      state.loading = false;
    }
  }

  async function moveThroughFeed(direction) {
    const moved = await loadVideoByDirection(direction);
    if (moved) {
      recordFeedScroll();
    }
  }

  async function showOverlay() {
    if (window.top !== window.self || !isLmsSite()) return;
    if (document.getElementById('rfv-tiktok-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'rfv-tiktok-overlay';
    overlay.className = 'rfv-tiktok-overlay';
    state.overlay = overlay;

    const shell = document.createElement('div');
    shell.className = 'rfv-tiktok-shell';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rfv-tiktok-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', removeOverlay);
    shell.appendChild(closeBtn);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'rfv-tiktok-frame';
    state.frameWrap = frameWrap;

    const loading = document.createElement('div');
    loading.className = 'rfv-tiktok-loading';
    loading.textContent = 'Loading TikTok video…';
    frameWrap.appendChild(loading);
    shell.appendChild(frameWrap);
    overlay.appendChild(shell);

    overlay.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) < 10) return;
        event.preventDefault();
        moveThroughFeed(event.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    let touchStartY = null;
    overlay.addEventListener('touchstart', (event) => {
      touchStartY = event.touches[0].clientY;
    });
    overlay.addEventListener('touchend', (event) => {
      if (touchStartY === null) return;
      const delta = touchStartY - event.changedTouches[0].clientY;
      if (Math.abs(delta) > 50) {
        moveThroughFeed(delta > 0 ? 1 : -1);
      }
      touchStartY = null;
    });

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    try {
      const videos = await fetchTikTokVideos();
      if (!videos.length) {
        throw new Error('No TikTok videos returned');
      }
      state.videos = videos;
      state.currentIndex = 0;

      const videoEl = document.createElement('video');
      videoEl.className = 'rfv-tiktok-iframe';
      videoEl.setAttribute('autoplay', 'true');
      videoEl.setAttribute('loop', 'true');
      videoEl.setAttribute('muted', 'true');
      videoEl.setAttribute('playsinline', 'true');
      videoEl.setAttribute('webkit-playsinline', 'true');
      state.videoEl = videoEl;
      frameWrap.innerHTML = '';
      frameWrap.appendChild(videoEl);
      await setVideoSource(videos[0]);
    } catch (error) {
      frameWrap.innerHTML = '';
      const fallback = document.createElement('div');
      fallback.className = 'rfv-tiktok-error';
      fallback.textContent = error.message || 'Unable to load TikTok video right now.';
      frameWrap.appendChild(fallback);
    }
  }

  document.addEventListener('keydown', (event) => {
    if (!state.overlay) return;
    if (state.breakOverlay) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      removeOverlay();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      moveThroughFeed(1);
    }
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      moveThroughFeed(-1);
    }
  }, true);

  if (document.body) {
    showOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', showOverlay, { once: true });
  }
})();
