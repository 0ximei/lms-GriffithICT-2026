const TIKTOK_API_URL = 'https://www.tiktok.com/api/recommend/item_list/?WebIdLastTime=1785549349&aid=1988&app_language=en-GB&app_name=tiktok_web&browser_language=en-AU&browser_name=Mozilla&browser_online=true&browser_platform=MacIntel&browser_version=5.0%20%28Macintosh%3B%20Intel%20Mac%20OS%20X%2010_15_7%29%20AppleWebKit%2F537.36%20%28KHTML%2C%20like%20Gecko%29%20Chrome%2F149.0.0.0%20Safari%2F537.36&channel=tiktok_web&clientABVersions=70508271%2C73720540%2C76124482%2C76314874%2C76378881%2C76388334%2C76406767%2C76424652%2C76432883%2C76463665%2C76484018%2C76523579%2C76581986%2C76600397%2C76604747%2C76612495%2C76615284%2C76622812%2C76689044%2C76702428%2C70405643%2C71057832%2C71200802%2C73171280%2C73208420%2C74008524%2C74276218%2C74413136%2C74844724%2C75330961&cookie_enabled=true&count=12&cpu_core_number=8&dark_mode=false&data_collection_enabled=true&day_of_week=6&device_id=7668876046959642129&device_platform=web_pc&device_score=8.12&device_type=web_h265&enable_cache=false&focus_state=false&from_page=fyp&history_len=2&isNonPersonalized=false&is_fullscreen=true&is_new_user=true&is_page_visible=true&itemID=&language=en&launch_mode=direct&network=1.4&odinId=7668876928619004946&os=mac&priority_region=&pullType=2&referer=&region=JP&screen_height=1169&screen_width=1800&showAboutThisAd=true&showAds=false&time_of_day=12&tz_name=Australia%2FBrisbane&video_encoding=dash&vv_count=16&vv_count_fyp=16&watchLiveLastTime=&webcast_language=en-GB&window_height=1042&window_width=1245&X-Dynosaur=MxapVm4WZWeZ9lCM9iBsrZIdOqVtsXUqRWnixyzCChZ-uXNODWITHb2hBd5ijQpWt37UU5MoPQKvjQb5Tty2/7yeC-6RCIi/6IrbEGH017fec4g9r5AccKzt/EyMhtQhQgtliJBEz55hFe-9c645jQev6u2Knf1Wt-kTpgZ6mUlGLzjA7hSkK8v-nbLngSfQ1x2ZDeQoJI/VjHx2pTmfuLOjs3zmTV3FqSxj9AWEZQKqdJfYQiNHyddrKViF014ahK9Rumlqc6/kpzhqt3YD4ub9NCUVsjOQDWJazAr3vJgdU9Do3kim2wGatsUguVe1/Bfo9lor5yE-HxmllMxlKH2kTj7RKcmcyTbtYZo8OG0w2QNWc9Lp5oQpqa/J3xUUXUwqoc1d9COYin/jw58RnqYJv-hA4mxqVwV0PJc4tjML1g7GZuPlJ6KJAy3Y&msToken=EZ7GcZKgO3GJE2suDsN8XyQQD5wiLgK8iXpNIpfCu3hZmxIk2Bc3tp_FxyXy7ER07A5pQM8xTl2roatOS3n2peHmoX6VpJJ7Q359zV7DPmUUhZzLqxmpVOOaWiLF6KHeA8ebZjuSsBQ0O6NaHsEJBukv8eywB2PPoQOtUUIwOg==&X-Bogus=1&X-Gnarly=Mwg1EoLEOzDEQXUNOxErUkmo/DIUIB5a7ejuydy2a7vs6x-eFaU4wc-npTcmhBzZvIQ6phmuuK6aTAOArKnRqtV1DtLdfWI7iurz5/vK22NbNDToyh6RzDYi5vzf/QR6MI08L--eVWODuOUAjonxGgGbdm2siowEhy4GA6MohVu8vRWXt/-f5aSHv9xdUCHQA7bP563MMGswuXQ8y7v1e3I74xTc7id-tFjI0a2KTwnFvDlawbbil95PBSRdoqwiHxNmBADcZQarw8a3c6padH0itRjD2sMrSl5Tz5Nvjxv0V8ZWG3HlX5D5RZ-vzrkD6M1Amwcnq3V1';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      const videos = (data?.itemList || [])
        .map((item) => {
          const id = item?.id || item?.video?.id || item?.videoID;
          const urlList = item?.video?.play_addr?.url_list
            || item?.video?.download_addr?.url_list
            || [];
          const videoUrl = urlList[0] || urlList.find(Boolean);

          if (!id || !videoUrl) {
            return null;
          }

          return { id: String(id), videoUrl: String(videoUrl) };
        })
        .filter(Boolean);

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
