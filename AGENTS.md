# Repository Instructions

## Workflow

1. Check `git status` before editing. Preserve user changes.
2. For bug fixes and features, create separate working branch by default. Use current branch when requested.
3. Read relevant implementation, callers, tests, and docs before changing behavior. If they conflict, surface conflict instead of guessing.
4. For bugs, trace failing path and shared callers. Fix narrowest layer that corrects cause without changing unrelated behavior.
5. Keep changes focused. Avoid unnecessary dependencies and unrelated refactoring.
6. Commit/PR, pull, or push only when requested. Use Conventional Commits: `<type>[optional scope]: <description>`.

## Testing

1. For every `dtf.user.js` change, increment `@version` patch.
2. Before finishing, run `node --check dtf.user.js` and relevant tests.
3. For full local checks, run commands from README.
4. Test browser changes in affected browser with temporary profile and Violentmonkey.
5. Install userscript and verify on DTF only in temporary profile. Do not use personal browser profile or perform checks requiring login unless explicitly requested.
6. Run focused tests during development. Run broader checks before finishing when change scope warrants them.

### Firefox integration checks

1. Check local Firefox and geckodriver availability first. If absent, request approval before downloading portable builds into fresh temporary directory. Do not install system packages. Official sources: `https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US`, `https://api.github.com/repos/mozilla/geckodriver/releases/latest`, and `https://addons.mozilla.org/api/v5/addons/addon/violentmonkey/`. Verify downloaded XPI against hash from AMO API.
2. Use geckodriver with fresh generated profile, explicit Firefox binary, `-headless`, and window size matching reported issue. Python standard-library `urllib.request` can call WebDriver HTTP API without Selenium. Bind test servers to `127.0.0.1`; serve current userscript through local HTTP server.
3. Create WebDriver session with `pageLoadStrategy: "none"` and bounded HTTP/script timeouts. Violentmonkey intercepts userscript navigation, so waiting for normal page-load completion can hang. Poll actual page state instead.
4. Install Violentmonkey using `POST /session/{sessionId}/moz/addon/install` with `{ "path": "/absolute/path/violentmonkey.xpi", "temporary": true }`. Navigate to local `dtf.user.js` URL, switch to manager's confirmation tab, and click **Install**. Do not substitute GM stubs for manager integration.
5. When automation needs extension UUID, launch geckodriver with `--allow-system-access`, switch WebDriver `/moz/context` to `chrome`, read `Services.prefs.getCharPref("extensions.webextensions.uuids")`, then switch back to `content`. This access is for isolated test profile only; Firefox rejects this flag when supplied through session capabilities.
6. Configure script through settings UI where possible. If using manager's `SetValueStores` command from extension page, obtain actual installed script ID and use serialized GM values: `"btrue"` for boolean true, `"bfalse"` for false, `"n3"` for number 3. Raw booleans/numbers decode incorrectly. Verify values read by userscript, not only stored keys.
7. On public DTF feed without login, compare disabled mode with enabled multiplier, then refresh and repeat. Record initial/final card counts, cursor requests, loader inline/computed styles, temporary transforms, `scrollY`, and console errors. Derive expected count from observed baseline, not hard-coded 24: baseline 12 with 3x means 36. Check visible cards as well as DOM count.
8. Always delete WebDriver session and stop owned driver/local server in cleanup. Keep logs/screenshots only in temporary directory. Report browser, manager, and userscript versions; distinguish live Firefox/Violentmonkey results from isolated fixtures. Successful check in different version/profile does not establish cause of user's failure.

## Documentation and plans

1. Update docs only when they describe changed behavior or contract. Avoid duplicating same information.
2. Keep comments and docs concise. Record non obvious constraints, not code narration.
3. Keep `docs/plans/` local and uncommitted. Never force add plans.
