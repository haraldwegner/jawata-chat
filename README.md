# jawata-chat

jawata's own chat: one ACP client and one view, hosted in VS Code now and in Eclipse and Theia later.
`packages/acp-contract` holds the recorded ACP sessions and the replay agent; `packages/vscode` is the VS Code extension.
The design is `ARCHITECTURE-acp-host-contract.md` in jawata-enterprise (`docs/sprints/jawata-mcp/`).

## Licence

AGPL-3.0-only; the full text is in `LICENSE` here and in each package. The code is jawata's own. Third-party libraries are bundled under their own licences, whose texts travel with the bundle (`packages/vscode/dist/webview.js.LICENSE.txt`).
