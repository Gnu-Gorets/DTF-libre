# Repository Instructions

1. For bug fixes and features, create separate working branch by default. Use current branch when requested. Preserve user changes; check `git status` first.
2. Use Conventional Commits: `<type>[optional scope]: <description>`. Commit, pull, or push only when requested.
3. For every `dtf.user.js` change, increment `@version` patch. Avoid unnecessary dependencies.
4. Before finishing, run `node --check dtf.user.js` and relevant tests. Test browser changes in affected browser with temporary profile and Violentmonkey; install userscript and verify on DTF.
5. Keep `docs/plans/` local and uncommitted. Never force add plans.
