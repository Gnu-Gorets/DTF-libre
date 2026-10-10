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

## Documentation and plans

1. Update docs only when they describe changed behavior or contract. Avoid duplicating same information.
2. Keep comments and docs concise. Record non obvious constraints, not code narration.
3. Keep `docs/plans/` local and uncommitted. Never force add plans.
