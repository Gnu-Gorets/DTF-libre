# Project rules

## Git
- Use Conventional Commits: `<type>[optional scope]: <description>`.
- Work only on local `stable`. Do not create or switch to feature branches.
- Before changes, check `git status` and preserve existing user changes.
- Commit changes to `stable` only when requested. Do not pull or push unless requested.

## Userscript
- After every change to `dtf.user.js`, increment `@version` patch by 1.
- Avoid unnecessary dependencies.

## Checks
- Before finishing, run `node --check dtf.user.js` and relevant tests.

## Browser testing
- Use Chromium with a temporary profile and Violentmonkey.
- Install repository's `dtf.user.js` and verify changes on DTF.

## Local plans
- Keep `docs/plans/` local. Never stage or commit plans; do not force-add them.
