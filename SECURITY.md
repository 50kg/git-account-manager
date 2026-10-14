# Security

Git Account Manager handles Git credentials, so here is exactly what it does with them.

## Where secrets live
- **Tokens / passwords** are stored only in the operating system's credential store (macOS Keychain, Windows Credential Manager) through `git credential`. The app's own config file (`config.json` in the app data folder) never contains secrets.
- **SSH keys** stay in `~/.ssh`. Generated keys are written there; deleting a key moves it to the Trash / Recycle Bin.

## Where secrets are sent
- To the **Git host** you are working with (GitHub / Gitee / GitLab / …) when you pull, fetch, clone, verify a token or upload a public key.
- **Nowhere else.** There is no telemetry, analytics or remote server.

## Safety measures
- Connectivity checks and clones pass credentials to Git through a read-only helper, so a failed request can't make Git erase the stored credential.
- Command output shown in the UI is scrubbed of tokens.
- The renderer runs with `contextIsolation`, `sandbox` and a strict Content-Security-Policy; it can only call a fixed set of main-process actions.
- Viewing a stored token/password requires an explicit click.

## Reporting a vulnerability
Please **do not** open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/50kg/git-account-manager/security/advisories/new) instead.
You'll get a reply as soon as possible.
