# Changelog

## 1.6.0 — 2026-11-01

### New / 新功能
- **Commit identity (name and email on commits).** Which account pushes is decided by the token or key, but the name and avatar on a commit come from `user.name` / `user.email` at commit time. An account can now carry a commit name and email. Switching a project to that account writes them into the project's `.git/config` too, shown in the confirmation and undoable from the history. Switching to an account without one (or to no account) only removes what the previous account wrote; anything you set for the project yourself is kept. Only new commits are affected.
  **提交身份（提交上的名字和邮箱）**：推送用哪个账号由 token 或密钥决定，提交上显示的名字和头像却看提交时的 `user.name` / `user.email`。现在账号可以带上提交用的名字和邮箱，项目换到这个账号时一起写进它的 `.git/config`，确认框里能看到改动，修改记录里可以撤销。换到没设提交身份的账号（或不指定账号）时，只去掉原来那个账号写进去的，你给项目单独设的不动。只影响以后的新提交。
- When editing an account, the name and emails from the website profile are suggested. For GitHub and GitLab the private noreply address is built from the account ID, so your real email stays private.
  编辑账号时会推荐网站资料里的名字和邮箱，GitHub、GitLab 还会按账号 id 拼出隐私邮箱（noreply），不暴露真实邮箱。
- Each project shows who new commits will be recorded as, and whether that is set for the project or comes from the global config. It can be changed per project. A project whose identity doesn't match its account is flagged under "Needs attention" and can be fixed in one click. After changing an account's identity, you're offered to write it into the projects using it.
  每个项目显示新提交会记成谁、是项目单独设置的还是来自全局配置，也可以单独修改。和绑定账号设置的不一致时，算进“需要处理”，一键改过来。改了账号的提交身份后，会问要不要写进正在用它的项目。
- Cloning with an account sets its commit identity in the new project. Export / import carries the commit name and email (still no secrets).
  用账号拉取仓库时，新项目直接带上它的提交身份。导出 / 导入账号配置时一起带上提交名字和邮箱（仍然不含密钥）。

## 1.5.0 — 2026-10-22

### Fixed / 修复
- **Tokens no longer disappear when GitHub CLI has taken over git.** After `gh auth setup-git`, git hands github.com credentials to gh, which pretends to save tokens but keeps nothing, and only gives out the account signed in to gh. Tokens added here then couldn't be read back, and the next refresh dropped those accounts as "deleted outside the app". The app now reads and writes tokens in the system credential store directly, checks every saved token by reading it back, and never drops an account just because a takeover hides it. The same goes for GitLab CLI (glab).
  **gh 接管 git 时 token 不会再“被删”**：`gh auth setup-git` 之后，git 把 github.com 的凭据交给 gh，gh 存的时候假装成功、其实什么都没存，读的时候只给 gh 当前登录的那个账号。于是在这里添加的 token 读不回来，下次刷新就被当成“在工具外面被删了”去掉。现在工具自己读写 token 时直接用系统密码库，保存后都读回来核对，也不会因为被挡住读不到就删账号。GitLab CLI（glab）同样处理。
- The message for accounts that really are gone now says why: deleted elsewhere, or cleared by git after the token stopped working.
  账号真的没了时，提示改为说明可能的原因：在别处删掉了，或者 token 失效后被 git 自动清掉。

### New / 新功能
- **Credential helper check per host.** *History & Settings → This computer* lists hosts whose git sign-in differs from the default: taken over by gh / glab, cached only (forgotten after 15 minutes), or stored as plain text.
  **按站点检查凭据助手**：“记录与设置 → 本机信息”列出与默认设置不同的站点：被 gh / glab 接管、只临时记住（15 分钟后忘掉）、明文保存。
- **Hand back to the credential store.** One click removes the lines gh / glab wrote into the global git config, after copying the tokens of accounts signed in to gh into the system credential store. The file is backed up first, and the change can be undone from the history.
  **一键交还**：先把 gh 里登录的账号 token 存进系统密码库，再删掉 gh / glab 写进全局 git 配置的那几行。改之前先备份，可以在修改记录里撤销。
- **GitHub CLI accounts.** See which accounts gh is signed in to and which one is active, switch, sign out, import a gh account into the app, or sign an account from the app in to gh. Everything goes through gh's own commands, only when you click, and tokens are passed on standard input.
  **管理 gh 账号**：查看 gh 登录了哪些账号、当前用哪个，切换、登出，把 gh 的账号导入工具，或者把工具里的账号登录到 gh。全部调用 gh 自己的命令，只在你点的时候执行，token 走标准输入。
- **Check for new versions.** The app looks up the latest release on GitHub when it opens and shows a "New version" button in the sidebar, with the release notes and a download of the right file for your computer (installer, portable or Mac chip). You can skip a version, or check any time under *History & Settings → Version*.
  **检查新版本**：打开软件时到 GitHub 查一次最新的正式版，有新版本就在侧栏显示“新版本”按钮，点开能看发布说明，并直接下载适合这台电脑的文件（安装版、便携版或对应 Mac 芯片）。可以跳过某个版本，也可以随时在“记录与设置 → 版本”里手动检查。

## 1.4.1 — 2026-10-15

### New / 新功能
- **JetBrains IDE check.** Detects JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, Android Studio…) whose Git settings don't have **Use credential helper** turned on. Those IDEs run Git with `-c credential.helper=`, which bypasses the system credential store, so pushing an HTTPS project pops up "Log In to GitHub" instead of using the saved token. The Projects page and *History & Settings → This computer* now say how to turn it on (Settings → Version Control → Git). IDE settings are only read, never changed.
  **JetBrains IDE 检查**：发现 IntelliJ IDEA、PyCharm、WebStorm、Android Studio 等没开 “Use credential helper” 时，在项目页和“记录与设置 → 本机信息”提示去 Settings → 版本控制 → Git 勾选。没开时 IDE 会用 `-c credential.helper=` 绕过系统密码库，推送 HTTPS 项目弹 “Log In to GitHub”。只读取 IDE 配置，不做修改。
- The check follows the IDE's most recent Git command in its log, so the hint goes away as soon as the option is ticked — the IDE writes it to its settings file only later. It's re-checked whenever you switch back to the app.
  检查以 IDE 日志里最近一次 git 命令为准：勾选后立即生效，不用等 IDE 把设置写盘（IDE 要过一阵才写）；切回本工具窗口时会自动重新检查。

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
