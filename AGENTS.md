# Repository Instructions

1. For every `dtf.user.js` change, increment `@version` patch.
2. Run `node --check dtf.user.js` and relevant tests. README lists full local checks.
3. Keep `docs/plans/` local and uncommitted; never force-add plans.

## Browser checks

1. Test browser changes in affected browser with Violentmonkey in temporary profile. Never use personal profile or run checks requiring login unless explicitly requested.
2. README documents Chromium manager integration. Keep live manager checks distinct from fixture tests using GM stubs.
3. Report browser, Violentmonkey, and userscript versions; distinguish live results from fixture-only checks.

### Firefox integration

1. Check local Firefox and geckodriver first. If either is missing, ask approval before downloading portable builds; do not install system packages. Official sources: `https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US`, `https://api.github.com/repos/mozilla/geckodriver/releases/latest`, and `https://addons.mozilla.org/api/v5/addons/addon/violentmonkey/`. Verify downloaded XPI against AMO API hash.
2. Use geckodriver with fresh profile, explicit Firefox binary, headless mode, bounded HTTP/script timeouts, and window size matching issue. Bind test servers to `127.0.0.1` and serve current userscript locally. Python standard-library `urllib.request` can call WebDriver API without Selenium.
3. Install Violentmonkey with `POST /session/{sessionId}/moz/addon/install` and `{ "path": "/absolute/path/violentmonkey.xpi", "temporary": true }`. Navigate to local `dtf.user.js` URL, switch to manager confirmation tab, and click **Install**. Do not replace manager integration with GM stubs.
4. Set WebDriver `pageLoadStrategy: "none"` and poll page state; Violentmonkey can intercept userscript navigation. Use settings UI where possible. For direct setup through manager's `SetValueStores`, use actual script ID and serialized GM values (`"btrue"`, `"bfalse"`, `"n3"`); verify values read by userscript.
5. If automation needs extension UUID, launch geckodriver with `--allow-system-access`, switch WebDriver `/moz/context` to `chrome`, read `Services.prefs.getCharPref("extensions.webextensions.uuids")`, then switch back to `content`. Restrict this access to isolated profile; Firefox rejects this flag in session capabilities.
6. For pagination checks, compare disabled and enabled modes, refresh and repeat. Derive expected count from observed baseline; check visible cards and DOM count, cursor requests, loader inline/computed styles, temporary transforms, `scrollY`, and console errors.
7. Always delete WebDriver session and stop owned driver and local server. Remove temporary profile and downloaded test builds. Keep logs and screenshots in temporary directory. Different browser or manager versions do not establish cause of user's failure.
