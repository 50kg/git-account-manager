# Contributing / 参与贡献

Thanks for your interest! / 感谢关注！

## Development
```bash
npm install
npm start
```
- `src/core.js` — all logic, no Electron dependency (easy to test with plain Node).
- `src/main.js` — Electron main process: window, dialogs, IPC.
- `renderer/` — UI (plain HTML/CSS/JS, no framework, no build step).

Please test against a throwaway Git setup: never commit real tokens, and avoid screenshots with real account names.
请用测试用的账号和仓库调试，不要提交真实 token，截图里也不要出现真实账号。

## Pull requests
- Keep changes focused; describe what and why.
- Match the existing style (2-space indent, semicolons, Chinese UI strings for now).
- UI strings will move to an i18n layer — new strings are welcome in both English and Chinese.

## Issues
Bug reports and feature requests are welcome. Please include your OS, Git version and the steps to reproduce.
