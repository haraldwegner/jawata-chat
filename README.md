# jawata-chat

jawata's own chat: one ACP client and one view, hosted in VS Code now and in Eclipse and Theia later.
`packages/acp-contract` holds the recorded ACP sessions and the replay agent; `packages/vscode` is the VS Code extension.
The design is `ARCHITECTURE-acp-host-contract.md` in jawata-enterprise (`docs/sprints/jawata-mcp/`).

## Building, and using the packages from another repository

`npm ci` then `npm run build` builds every package on a fresh clone, in the order the packages' own dependencies set
(`scripts/build.mjs`; the order is tested, not alphabetical). Another repository — the Eclipse plug-in, a Theia host — takes the
library packages as tarballs: `npm run pack` builds and writes `packed/jawata-acp-contract-<v>.tgz`, `packed/jawata-chat-core-<v>.tgz`
and `packed/jawata-chat-view-<v>.tgz`, which that repository installs with `npm install <path>/packed/<file>.tgz`. The packages are
private: they are not published to a registry.

## Licence

AGPL-3.0-only; the full text is in `LICENSE` here and in each package. The code is jawata's own. Third-party libraries are bundled under their own licences, whose texts travel with the bundle (`packages/vscode/dist/webview.js.LICENSE.txt`).
