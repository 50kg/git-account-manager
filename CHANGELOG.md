# Changelog

## 1.4.0 — 2026-10-15

### New / 新功能
- **English UI.** The whole app — pages, dialogs, status messages and system dialogs — is available in English and Simplified Chinese. It follows your system language; switch any time from the sidebar or *History & Settings → Language*.
  **英文界面**：页面、弹窗、状态提示和系统对话框都支持中英文，默认跟随系统语言，可在左下角或“记录与设置 → 语言”随时切换。
- README screenshots in both languages. / README 截图提供中英文两套。

### Builds / 安装包
- macOS (Apple Silicon & Intel) builds are back alongside Windows. / 恢复 macOS（Apple 芯片与 Intel）安装包，与 Windows 版同时发布。

## 1.3.1 — 2026-10-15

### New
- Projects: **Clone repository…** — paste a repository URL (web page URLs such as `…/tree/main` work too), pick an account, or none for public repositories, and clone straight into the project list.
- Accounts: tokens stored under placeholder usernames such as `x-access-token` are shown under their real login.
- Click `~/.ssh` to open the folder.

### Windows fixes
- "Terminal" now opens in the project folder.
- Accounts already saved in Windows Credential Manager are detected on non-English Windows, and e-mail usernames are no longer misread (`bob@example.com` showed up as `bob_example.com`).
- Deleting an account removes every Credential Manager entry for it.
- Timed-out Git operations stop the whole process tree instead of leaving Git/SSH running in the background.
- Removed the default English menu bar; Windows wording (Recycle Bin, Credential Manager, Ctrl+F).
- The clone dialog defaults to the system Documents folder, even when it has been moved.

### Other
- Projects without a remote show "local only" and no longer count as failing.
- Long status messages no longer overlap the row arrow.
- `file://` remotes are no longer mistaken for SSH addresses.

## 1.3.0 — 2026-10-14

First public release.

### Projects
- Drag-and-drop folders to add projects; repos inside a parent folder are found automatically.
- Per-project account picker that shows whether each account can access the repository.
- "Apply suggestions" to bind all projects in one click.
- Check for updates (`git fetch`), see unpushed commits and uncommitted changes, one-click fast-forward pull.
- Clickable status filters; open in Finder/Explorer, Terminal, Sourcetree or the web.

### Accounts
- Paste a token to add a GitHub / Gitee / GitLab account — host, user and accessible repositories are detected automatically.
- Two-way sync with the system credential store and `~/.ssh`.
- Generate SSH keys and register them on the host through the API.
- Clone accessible repositories directly into the project list.
- View token / password / public key on demand.

### Other
- Change history with undo; export/import account settings without secrets.
- macOS (Apple Silicon & Intel) and Windows (installer & portable) builds.
