const TIKTOK_API_URL = 'https://www.tiktok.com/api/recommend/item_list/?WebIdLastTime=1785549349&aid=1988&app_language=en-GB&app_name=tiktok_web&browser_language=en-AU&browser_name=Mozilla&browser_online=true&browser_platform=MacIntel&browser_version=5.0%20%28Macintosh%3B%20Intel%20Mac%20OS%20X%2010_15_7%29%20AppleWebKit%2F537.36%20%28KHTML%2C%20like%20Gecko%29%20Chrome%2F149.0.0.0%20Safari%2F537.36&channel=tiktok_web&clientABVersions=70508271%2C73720540%2C76124482%2C76314874%2C76378881%2C76388334%2C76406767%2C76424652%2C76432883%2C76463665%2C76484018%2C76523579%2C76581986%2C76600397%2C76604747%2C76612495%2C76615284%2C76622812%2C76689044%2C76702428%2C70405643%2C71057832%2C71200802%2C73171280%2C73208420%2C74008524%2C74276218%2C74413136%2C74844724%2C75330961&cookie_enabled=true&count=12&cpu_core_number=8&dark_mode=false&data_collection_enabled=true&day_of_week=6&device_id=7668876046959642129&device_platform=web_pc&device_score=8.12&device_type=web_h265&enable_cache=false&focus_state=false&from_page=fyp&history_len=2&isNonPersonalized=false&is_fullscreen=true&is_new_user=true&is_page_visible=true&itemID=&language=en&launch_mode=direct&network=1.4&odinId=7668876928619004946&os=mac&priority_region=&pullType=2&referer=&region=JP&screen_height=1169&screen_width=1800&showAboutThisAd=true&showAds=false&time_of_day=12&tz_name=Australia%2FBrisbane&video_encoding=dash&vv_count=16&vv_count_fyp=16&watchLiveLastTime=&webcast_language=en-GB&window_height=1042&window_width=1245&X-Dynosaur=MxapVm4WZWeZ9lCM9iBsrZIdOqVtsXUqRWnixyzCChZ-uXNODWITHb2hBd5ijQpWt37UU5MoPQKvjQb5Tty2/7yeC-6RCIi/6IrbEGH017fec4g9r5AccKzt/EyMhtQhQgtliJBEz55hFe-9c645jQev6u2Knf1Wt-kTpgZ6mUlGLzjA7hSkK8v-nbLngSfQ1x2ZDeQoJI/VjHx2pTmfuLOjs3zmTV3FqSxj9AWEZQKqdJfYQiNHyddrKViF014ahK9Rumlqc6/kpzhqt3YD4ub9NCUVsjOQDWJazAr3vJgdU9Do3kim2wGatsUguVe1/Bfo9lor5yE-HxmllMxlKH2kTj7RKcmcyTbtYZo8OG0w2QNWc9Lp5oQpqa/J3xUUXUwqoc1d9COYin/jw58RnqYJv-hA4mxqVwV0PJc4tjML1g7GZuPlJ6KJAy3Y&msToken=EZ7GcZKgO3GJE2suDsN8XyQQD5wiLgK8iXpNIpfCu3hZmxIk2Bc3tp_FxyXy7ER07A5pQM8xTl2roatOS3n2peHmoX6VpJJ7Q359zV7DPmUUhZzLqxmpVOOaWiLF6KHeA8ebZjuSsBQ0O6NaHsEJBukv8eywB2PPoQOtUUIwOg==&X-Bogus=1&X-Gnarly=Mwg1EoLEOzDEQXUNOxErUkmo/DIUIB5a7ejuydy2a7vs6x-eFaU4wc-npTcmhBzZvIQ6phmuuK6aTAOArKnRqtV1DtLdfWI7iurz5/vK22NbNDToyh6RzDYi5vzf/QR6MI08L--eVWODuOUAjonxGgGbdm2siowEhy4GA6MohVu8vRWXt/-f5aSHv9xdUCHQA7bP563MMGswuXQ8y7v1e3I74xTc7id-tFjI0a2KTwnFvDlawbbil95PBSRdoqwiHxNmBADcZQarw8a3c6padH0itRjD2sMrSl5Tz5Nvjxv0V8ZWG3HlX5D5RZ-vzrkD6M1Amwcnq3V1';

function collectVideoUrls(value) {
  if (!value) return [];
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectVideoUrls(entry));
  }
  if (typeof value !== 'object') return [];

  const directKeys = ['urlList', 'UrlList', 'url_list', 'url'];
  const nestedKeys = ['playAddr', 'play_addr', 'PlayAddr', 'PlayAddrStruct', 'playAddrStruct', 'downloadAddr', 'download_addr'];

  for (const key of directKeys) {
    const candidate = value[key];
    if (candidate) {
      const urls = collectVideoUrls(candidate);
      if (urls.length) return urls;
    }
  }

  for (const key of nestedKeys) {
    const candidate = value[key];
    if (candidate) {
      const urls = collectVideoUrls(candidate);
      if (urls.length) return urls;
    }
  }

  return [];
}

function resolveVideoUrl(item) {
  if (!item) return null;
  if (typeof item.videoUrl === 'string' && item.videoUrl.trim()) return item.videoUrl.trim();
  if (typeof item.url === 'string' && item.url.trim()) return item.url.trim();

  const video = item.video || item;
  const candidates = [
    video?.playAddr,
    video?.play_addr,
    video?.PlayAddrStruct,
    video?.playAddrStruct,
    video?.downloadAddr,
    video?.download_addr,
    video?.bitrateInfo,
    video?.bitrate_info,
  ];

  for (const candidate of candidates) {
    const urls = collectVideoUrls(candidate);
    if (urls.length) return urls[0];
  }

  return null;
}

function normalizeTikTokItems(items) {
  return (items || [])
    .map((item) => {
      const id = item?.id || item?.video?.id || item?.video?.videoID || item?.videoID || item?.video_id;
      const videoUrl = resolveVideoUrl(item);

      if (!id || !videoUrl) {
        return null;
      }

      return { id: String(id), videoUrl: String(videoUrl) };
    })
    .filter(Boolean);
}

globalThis.__rfvTikTokHelpers = {
  normalizeTikTokItems,
  resolveVideoUrl,
};

const TIKTOK_VIDEO_HEADER_RULE_ID = 1001;
const TIKTOK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// Pinned to the exact cookie snapshot captured alongside TIKTOK_API_URL above.
// Both were captured from the same live session, so the identity baked into
// item_list's signed video URLs (via msToken/X-Bogus/X-Gnarly in that URL)
// matches this cookie set — that's why this exact pair works. Reading cookies
// live from the browser instead broke this, because item_list is still a
// stale/static capture, not a live-cookie request, so "live" cookies didn't
// match the identity the video URL was actually signed against.
const TIKTOK_VIDEO_COOKIE = 'tt_csrf_token=i4X6OEF9-eQXqAFVJ8DstXvEexlToBZnPJes; tt_chain_token=8DTVY1L1gxXJB19yBU+csA==; ttwid=1%7CicVnFFLNt5mCW0TLUHUzEphUyOT16nLmUf-kLZH6ba4%7C1785554709%7Cf6e0ca54ca292c71cc43aa98fbad167fdc2d7e2e139d29c9cf05a7e8baf425dc; msToken=Ffy0_5ZXw0HcT5PDaEP2gp0ilEKi737Yz_ET1pAwj0UXQMBsCNtifE2YT6ZH3S4rwpnjGYj1CWyESVWvuGPdhsE1rQEfoPamVywNKf61JcM-hjOKGLiZK5bdFWUjugVp7U9_bQygXQRFw_ruZA3TWgoeG-vd3_wlf6uxk56a4Q==';

// fetch() silently drops Cookie/Origin/Referer/Sec-Fetch-*/User-Agent because
// they're "forbidden request headers" per the Fetch spec, so a real TikTok CDN
// request can't be built by passing them in a headers object. Instead, use
// declarativeNetRequest to rewrite the outgoing headers at the network layer.
//
// The video itself is fetched by the content script, not here: the bytes would
// otherwise have to cross the extension message boundary, which is JSON-encoded
// and capped at 64MiB. The response rule below adds CORS headers so that
// cross-origin fetch from the page is permitted.
async function refreshTikTokVideoHeaderRule() {
<<<<<<< HEAD
  await chrome.declarativeNetRequest?.updateSessionRules({
=======
  if (!chrome.declarativeNetRequest?.updateSessionRules) {
    throw new Error(
      'The "declarativeNetRequest" permission is missing from manifest.json — without it the TikTok CDN request cannot send Cookie/Origin/Referer and will 403.'
    );
  }

  await chrome.declarativeNetRequest.updateSessionRules({
>>>>>>> 614c58e (multiple reels)
    removeRuleIds: [TIKTOK_VIDEO_HEADER_RULE_ID],
    addRules: [
      {
        id: TIKTOK_VIDEO_HEADER_RULE_ID,
        priority: 1,
        condition: {
          urlFilter: 'tiktok.com/video/',
          resourceTypes: ['xmlhttprequest', 'other'],
        },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://www.tiktok.com/' },
            { header: 'Origin', operation: 'set', value: 'https://www.tiktok.com' },
            { header: 'User-Agent', operation: 'set', value: TIKTOK_UA },
            { header: 'Priority', operation: 'set', value: 'u=1, i' },
            { header: 'Sec-Fetch-Dest', operation: 'set', value: 'empty' },
            { header: 'Sec-Fetch-Mode', operation: 'set', value: 'cors' },
            { header: 'Sec-Fetch-Site', operation: 'set', value: 'same-site' },
            { header: 'Sec-CH-UA', operation: 'set', value: '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"' },
            { header: 'Sec-CH-UA-Mobile', operation: 'set', value: '?0' },
            { header: 'Sec-CH-UA-Platform', operation: 'set', value: '"macOS"' },
            { header: 'Cookie', operation: 'set', value: TIKTOK_VIDEO_COOKIE },
          ],
          responseHeaders: [
            // The page's own origin (griffith.edu.au) does the fetch, so the
            // CDN response needs to opt into it. '*' is valid here because the
            // browser treats this as a non-credentialed request — the Cookie
            // above is injected at the network layer, not via fetch credentials.
            { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
            { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
            { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
          ],
        },
      },
    ],
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'prepareTikTokVideoFetch') {
    (async () => {
      try {
        await refreshTikTokVideoHeaderRule();
        sendResponse({ ready: true });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }

  if (message?.type !== 'getTikTokVideoId' && message?.type !== 'getTikTokVideoIds') return;

  (async () => {
    try {
      const response = await fetch(TIKTOK_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://www.tiktok.com/',
          Origin: 'https://www.tiktok.com',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        },
        body: '',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`TikTok request failed: ${response.status}`);
      }

      const data = await response.json();
      const videos = normalizeTikTokItems(data?.itemList || []);

      if (!videos.length) {
        throw new Error('No TikTok video urls returned');
      }

      sendResponse({ videos });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();

  return true;
});
