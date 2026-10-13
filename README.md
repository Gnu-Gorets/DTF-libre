# DTF-libre

Userscript for DTF feed layout and image loading.

## Installation

Install [`dtf.user.js`](dtf.user.js) through Violentmonkey or Tampermonkey. Open `https://dtf.ru/`, then select `Настройки` in userscript manager menu of this JS script. Replace existing installation rather than running multiple copies. Personalization settings include six theme colors, optional HTTPS background image URL, and theme-code import/export; Violentmonkey stores settings separately from script updates.

## Initial feed loading

When **Дополнительно загружать посты** is enabled on page load, initial feed stays hidden with fixed intermediate height until selected batch is ready. Scrollbar is withheld with its gutter reserved while site layout settles. Cards appear together after filters and layout are applied; no loading text or forced scroll is added. This prevents intermediate scrollbar resizing, but delays first display. Gate releases after failed pagination, at most 60 seconds, or when setting is disabled or route changes. Later infinite scrolling remains native and changes scrollbar size as posts arrive.

Firefox users who see native cards briefly before userscript starts can enable **Alternative page mode** in Violentmonkey advanced settings. This preserved page-context hooks and avoided early partial display in isolated Firefox 158.0 / Violentmonkey 2.49.0 checks. Manager startup remains outside userscript control; `document-start` alone does not guarantee execution before page scripts. See [Violentmonkey injection timing](https://violentmonkey.github.io/api/metadata-block/#run-at). Do not switch injection context to `content`: this script needs page JavaScript access.

Initial card-count stabilization starts as soon as cards arrive. After native pagination trigger, script waits up to 15 seconds for new cards even if native loader stays hidden; hidden indicator does not prove that no request is in flight. Network speed and sequential cursor pagination remain controlled by DTF.

## Image loading

- Post media and gallery images load eagerly, including when new posts are added while scrolling. Avatar and other small images keep native lazy loading. Chromium handles image requests in parallel; no custom sequential download queue exists.
- Video poster images are prefetched from API and initial server-rendered feed data before playback. MP4 streams remain under DTF's lazy-loading behavior to avoid downloading unseen videos in full.
- Post media uses asynchronous image decoding. The userscript does not add loading or failure placeholders; CDN/network failures remain visible as provided by DTF/browser.
- The image quality setting selects responsive image sizes through `picture`/`srcset`, accounts for pixel density once, and limits each variant to 2560 px. Repeated DOM updates preserve selected URLs; resize recomputes sizes, disabling quality restores original URLs and styles. Classic galleries use uncropped original images to avoid blur when CSS enlarges them.
- DOM updates share one animation-frame callback instead of repeatedly applying settings within one frame.

Eager loading starts requests for rendered post images, including off-screen gallery slides. Classic galleries also use full originals, so they can consume more bandwidth. Disable image quality enhancement when transfer size matters. Network stalls and unavailable CDN files cannot be eliminated by userscript.

## Checks

Run from repository root:

```sh
node --check dtf.user.js
for test in tests/*.cjs; do node "$test" || exit; done
python3 tests/test_topics_api.py
```

Chromium checks use temporary profiles and minimal GM API stubs; `tests/test_chromium_topics.cjs` covers settings toggles and Live reconnect lifecycle. Real integration was smoke-tested separately in a temporary profile with Violentmonkey 2.49.0: install this userscript, enable **Allow User Scripts** in `chrome://extensions`, restart Chromium, open DTF, then verify injected styles and `.dtf-vm-top`. A client-side route change retained userscript behavior. This manager check is manual; it requires no login.

Matched sample of 37 WebP image responses at DPR=2 transferred about 6.36 MB before correction and 3.78 MB after correction. This is sample-specific bandwidth reduction, not site-wide speed guarantee. CDN/network latency remained variable.
