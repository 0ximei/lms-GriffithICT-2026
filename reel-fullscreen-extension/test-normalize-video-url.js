const assert = require('assert');

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener() {},
    },
  },
};

require('./background.js');

const { normalizeTikTokItems } = globalThis.__rfvTikTokHelpers;

const sampleItems = [
  {
    id: '123',
    video: {
      playAddr: {
        urlList: ['https://example.com/video.mp4'],
      },
      PlayAddrStruct: {
        UrlList: ['https://example.com/alt.mp4'],
      },
      bitrateInfo: [
        {
          PlayAddr: {
            UrlList: ['https://example.com/bitrate.mp4'],
          },
        },
      ],
      downloadAddr: {
        url_list: ['https://example.com/download.mp4'],
      },
    },
  },
];

const videos = normalizeTikTokItems(sampleItems);
assert.deepStrictEqual(videos, [{ id: '123', videoUrl: 'https://example.com/video.mp4' }]);
console.log('normalizeTikTokItems regression test passed');
