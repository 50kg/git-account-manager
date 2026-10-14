# Changelog

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
