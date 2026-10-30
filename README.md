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
Each rule has org, repo, from (head) and into (base) branch fields for github.com: names ignoring case, `*` as a wildcard, empty for any. First matching rule wins; use "Optimize rules" to order by specificity. Regex rules from v1 settings are converted on load; ones that can't be are kept disabled with the old pattern in their name.
Branches are read from the PR header; if a branch rule could apply, controls stay pending until they are found (up to 4s, then branch rules are skipped).
GitHub has no stable hooks for the merge controls, so they are located by label text; selectors live at the top of `src/content.ts`.
