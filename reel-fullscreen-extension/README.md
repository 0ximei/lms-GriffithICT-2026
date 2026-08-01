# Reel Fullscreen Viewer

Chrome/Edge (Manifest V3) extension. Double-click any video on Instagram or a
`*.griffith.edu.au` page (e.g. the LMS) — or click the floating `⛶` button —
to open it in a fullscreen overlay. The video is drawn frame-by-frame onto a
transparent `<canvas>`, sitting over a semi-transparent backdrop so the page
behind is still faintly visible around the video. Adjust the backdrop
opacity from the toolbar popup. Press `Esc` or the `✕` to exit.

If the video sits inside a scrollable feed with more than one video (e.g.
Instagram's Reels feed), feed mode activates automatically: scroll the mouse
wheel, swipe, use the `▲`/`▼` buttons, or press `↑`/`↓` to move to the next
reel. Under the hood this scrolls Instagram's own feed container to the next
`<video>` element, so Instagram's native autoplay/pause logic keeps driving
playback — the extension just repoints the canvas at whichever reel becomes
active.

## Floating reel panel on the LMS

On every page under `*.griffith.edu.au` (top frame only), the extension can
show a small draggable, minimizable panel with TikToks playing, at whatever
backdrop opacity you set. It uses TikTok's own public embed widget
(`tiktok.com/embed/v2/<video-id>` — the same iframe format TikTok generates
for embedding videos on any website), so it only shows specific public
videos you add, not a live personalized feed — the extension never touches a
logged-in TikTok (or Instagram) session. There's no public "give me a random
video" API on either platform without a session, so "random" here means
random selection *within the list you've saved*, not a random video from
all of TikTok.

To use it: open the toolbar popup, paste one or more full
`tiktok.com/@user/video/<id>` URLs (they don't need to be your own account's
— short `vm.tiktok.com`/`vt.tiktok.com` links won't work since resolving
them needs a network request the extension doesn't make), and toggle
**Enable panel** on. The panel opens on a random entry from your list each
page load; `◀`/`▶` step through it in order, `🔀` jumps to another random
one, `—` minimizes to just the title bar, and `✕` hides it (re-enable from
the popup). Position and playlist persist via `chrome.storage.sync`.

## Load it

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Visit Instagram Reels or the LMS and double-click a video, or add reel
   URLs from the popup for the floating panel

## Known limitations

- If the LMS embeds its video player inside a cross-origin `<iframe>` (e.g. a
  Panopto/Kaltura/YouTube embed on a different subdomain), the content script
  can only reach videos inside frames that also match `*.griffith.edu.au`. If
  the floating button shows `⚠`, no reachable `<video>` element was found on
  that page/frame.
- If Moodle/the LMS sends a strict `Content-Security-Policy` with a
  `frame-src` directive that excludes `instagram.com`, the browser will block
  the embed iframe regardless of what the extension does — that's enforced
  server-side and can't be worked around from a content script.
