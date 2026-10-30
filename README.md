# Merge Guard for GitHub

Hide merge / squash / rebase options on GitHub pull requests, with a default policy and ordered per-repo or per-org regex rules. UI-only: enforce real policy in repository settings.

## Develop
```sh
mise install        # node 24.19.0, yarn 4.18.1
yarn install
yarn build          # -> dist/chrome, dist/firefox   (yarn watch for dev)
yarn typecheck && yarn test
```
Load `dist/chrome` via chrome://extensions (Developer mode, Load unpacked) or `dist/firefox/manifest.json` via about:debugging (Load Temporary Add-on).

## Rules
Patterns are regexes matched case-insensitively from the start of `host/owner/repo/`. First matching rule wins; use "Optimize rules" to order by specificity.
GitHub has no stable hooks for the merge controls, so they are located by label text; selectors live at the top of `src/content.ts`.
