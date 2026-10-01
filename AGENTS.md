# Project rules

- After each change to `dtf.user.js`, increment patch version in `@version` by 1: `0.0.1` → `0.0.2` → `0.0.3`.
- Before finishing, run `node --check dtf.user.js` and relevant tests.
- Avoid unnecessary dependencies.
- Keep files under `docs/plans/` local; never stage or commit plans. The directory is gitignored, so do not force-add it.
- For manual browser testing, launch Chromium with a temporary profile and install the repository's `dtf.user.js` in Violentmonkey (userscript manager); verify changes on DTF in that isolated profile.
