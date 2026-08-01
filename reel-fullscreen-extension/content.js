(() => {
  if (window.__rfvTikTokOverlayInjected) return;
  window.__rfvTikTokOverlayInjected = true;

  const TIKTOK_API_URL = 'https://www.tiktok.com/api/recommend/item_list/?WebIdLastTime=1785549349&aid=1988&app_language=en-GB&app_name=tiktok_web&browser_language=en-AU&browser_name=Mozilla&browser_online=true&browser_platform=MacIntel&browser_version=5.0%20%28Macintosh%3B%20Intel%20Mac%20OS%20X%2010_15_7%29%20AppleWebKit%2F537.36%20%28KHTML%2C%20like%20Gecko%29%20Chrome%2F149.0.0.0%20Safari%2F537.36&channel=tiktok_web&clientABVersions=70508271%2C73720540%2C76124482%2C76314874%2C76378881%2C76388334%2C76406767%2C76424652%2C76432883%2C76463665%2C76484018%2C76523579%2C76581986%2C76600397%2C76604747%2C76612495%2C76615284%2C76622812%2C76689044%2C76702428%2C70405643%2C71057832%2C71200802%2C73171280%2C73208420%2C74008524%2C74276218%2C74413136%2C74844724%2C75330961&cookie_enabled=true&count=12&cpu_core_number=8&dark_mode=false&data_collection_enabled=true&day_of_week=6&device_id=7668876046959642129&device_platform=web_pc&device_score=8.12&device_type=web_h265&enable_cache=false&focus_state=false&from_page=fyp&history_len=2&isNonPersonalized=false&is_fullscreen=true&is_new_user=true&is_page_visible=true&itemID=&language=en&launch_mode=direct&network=1.4&odinId=7668876928619004946&os=mac&priority_region=&pullType=2&referer=&region=JP&screen_height=1169&screen_width=1800&showAboutThisAd=true&showAds=false&time_of_day=12&tz_name=Australia%2FBrisbane&video_encoding=dash&vv_count=16&vv_count_fyp=16&watchLiveLastTime=&webcast_language=en-GB&window_height=1042&window_width=1245&X-Dynosaur=MxapVm4WZWeZ9lCM9iBsrZIdOqVtsXUqRWnixyzCChZ-uXNODWITHb2hBd5ijQpWt37UU5MoPQKvjQb5Tty2/7yeC-6RCIi/6IrbEGH017fec4g9r5AccKzt/EyMhtQhQgtliJBEz55hFe-9c645jQev6u2Knf1Wt-kTpgZ6mUlGLzjA7hSkK8v-nbLngSfQ1x2ZDeQoJI/VjHx2pTmfuLOjs3zmTV3FqSxj9AWEZQKqdJfYQiNHyddrKViF014ahK9Rumlqc6/kpzhqt3YD4ub9NCUVsjOQDWJazAr3vJgdU9Do3kim2wGatsUguVe1/Bfo9lor5yE-HxmllMxlKH2kTj7RKcmcyTbtYZo8OG0w2QNWc9Lp5oQpqa/J3xUUXUwqoc1d9COYin/jw58RnqYJv-hA4mxqVwV0PJc4tjML1g7GZuPlJ6KJAy3Y&msToken=EZ7GcZKgO3GJE2suDsN8XyQQD5wiLgK8iXpNIpfCu3hZmxIk2Bc3tp_FxyXy7ER07A5pQM8xTl2roatOS3n2peHmoX6VpJJ7Q359zV7DPmUUhZzLqxmpVOOaWiLF6KHeA8ebZjuSsBQ0O6NaHsEJBukv8eywB2PPoQOtUUIwOg==&X-Bogus=1&X-Gnarly=Mwg1EoLEOzDEQXUNOxErUkmo/DIUIB5a7ejuydy2a7vs6x-eFaU4wc-npTcmhBzZvIQ6phmuuK6aTAOArKnRqtV1DtLdfWI7iurz5/vK22NbNDToyh6RzDYi5vzf/QR6MI08L--eVWODuOUAjonxGgGbdm2siowEhy4GA6MohVu8vRWXt/-f5aSHv9xdUCHQA7bP563MMGswuXQ8y7v1e3I74xTc7id-tFjI0a2KTwnFvDlawbbil95PBSRdoqwiHxNmBADcZQarw8a3c6padH0itRjD2sMrSl5Tz5Nvjxv0V8ZWG3HlX5D5RZ-vzrkD6M1Amwcnq3V1';

  function isLmsSite() {
    return /(^|\.)griffith\.edu\.au$/.test(location.hostname);
  }

  const state = {
    overlay: null,
    frameWrap: null,
    videoEl: null,
    videos: [],
    currentIndex: 0,
    loading: false,
  };

  function removeOverlay() {
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
    if (state.loading) return;
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
    } catch (error) {
      if (state.frameWrap) {
        state.frameWrap.innerHTML = '';
        const fallback = document.createElement('div');
        fallback.className = 'rfv-tiktok-error';
        fallback.textContent = error.message || 'Unable to load TikTok video right now.';
        state.frameWrap.appendChild(fallback);
      }
    } finally {
      state.loading = false;
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
        loadVideoByDirection(event.deltaY > 0 ? 1 : -1);
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
        loadVideoByDirection(delta > 0 ? 1 : -1);
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
    if (event.key === 'Escape') {
      removeOverlay();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      loadVideoByDirection(1);
    }
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      loadVideoByDirection(-1);
    }
  });

  if (document.body) {
    showOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', showOverlay, { once: true });
  }
})();
