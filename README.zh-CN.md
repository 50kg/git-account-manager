<div align="center">

<img src="docs/icon.png" width="112" alt="Git 账号管家图标">

# Git 账号管家

**在一个地方决定每个 Git 项目用哪个账号拉取 / 推送 —— token 和 SSH 密钥统一管理，支持 macOS 与 Windows。**

[![Release](https://img.shields.io/github/v/release/50kg/git-account-manager?color=2f6fde)](https://github.com/50kg/git-account-manager/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/50kg/git-account-manager/total?color=1f8a4c)](https://github.com/50kg/git-account-manager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

[English](README.md) · 简体中文

<img src="docs/screenshots/projects.png" width="880" alt="项目页">

</div>

---

## 为什么需要它

如果你同时有公司给的 GitHub token、自己的 GitHub 账号、Gitee 账号，再加上几把 SSH 密钥，大概率遇到过：

> 拉项目 A 时 Git 让输密码，你粘贴了账号 B 的 token —— 结果项目 C 拉不了了。

原因是系统密码库（macOS 钥匙串 / Windows 凭据管理器）按 **“站点 + 用户名”** 保存密码。项目地址里如果没写用户名（`https://github.com/org/repo.git`），同一站点的所有项目只能共用一份凭据，谁最后存进去就用谁的。

**Git 账号管家** 让每个项目各用各的账号：

- HTTPS 项目：把用户名写进远程地址（`https://alice@github.com/org/repo.git`），每个账号有自己的一份凭据；
- SSH 项目：通过 `core.sshCommand` 指定用哪把密钥，不用折腾 `~/.ssh/config`。

只修改项目的 `.git/config`，不碰代码，每次修改都能撤销。

## 功能

**项目**
- 把项目文件夹拖进窗口（拖普通文件夹会自动找出里面的 Git 项目）。
- 给每个项目选账号：选择面板会标出每个账号**对这个仓库有没有权限**（可推送 / 只读 / 授权里没有）。
- “按建议绑定”一键给所有项目配好账号。
- 一眼看到：本地改动、未推送的提交、远程的新提交。**一键拉取**（只做快进；分叉或会覆盖本地改动时拒绝执行并说明原因）。
- 顶部统计数字可点击筛选：需处理 / 有更新 / 有改动 / 连不上。
- 一键在访达 / 资源管理器、终端、**Sourcetree**、仓库网页中打开。

**账号** —— 与本机完全同步
- **粘贴 token 就行**：自动识别是 GitHub / Gitee / GitLab 的哪个账号、能访问哪些仓库。
- 钥匙串里已有的账号、`~/.ssh` 里已有的密钥自动出现；SSH 被代理拦截时，也能通过 GitHub 公开的公钥比对认出密钥主人。
- 在这里添加 → 写入钥匙串 / `~/.ssh`；在这里删除 → 从钥匙串删除，SSH 密钥移到废纸篓。
- **生成 SSH 密钥**，并通过 API 自动把公钥登记到 GitHub / Gitee / GitLab，不用手动复制粘贴。
- **拉取到本地**：点账号能访问的仓库名，直接克隆并加入项目列表，已经绑定好这个账号。
- 随时查看 token / 密码原文、SSH 公钥。

**安全**
- token 只存在系统密码库，本工具自己的配置文件里没有任何密钥。
- 检查连通性时以只读方式把凭据交给 Git，检查失败也不会让 Git 把你存的 token 删掉。
- 完整的修改记录，随时撤销；账号配置可导出 / 导入（不含密钥），方便在多台电脑间同步。

## 截图

| 选账号时直接看到有没有权限 | 账号按 HTTPS / SSH 分组 |
|---|---|
| <img src="docs/screenshots/picker.png" alt="选账号"> | <img src="docs/screenshots/accounts.png" alt="账号"> |

| 应用内解释 token 和 SSH 的区别 | 修改记录，可撤销 |
|---|---|
| <img src="docs/screenshots/help.png" alt="token 与 SSH"> | <img src="docs/screenshots/records.png" alt="修改记录"> |

> 截图使用的是虚构的演示数据。

## 下载

到 **[Releases](https://github.com/50kg/git-account-manager/releases/latest)** 下载最新版本：

| 平台 | 文件 |
|---|---|
| macOS（Apple 芯片） | `Git-Account-Manager-<版本>-arm64.dmg` |
| macOS（Intel 芯片） | `Git-Account-Manager-<版本>-x64.dmg` |
| Windows（安装版） | `Git-Account-Manager-Setup-<版本>.exe` |
| Windows（免安装） | `Git-Account-Manager-<版本>-portable.exe` |

需要先安装 [Git](https://git-scm.com/downloads)。

> **macOS：** 应用还没有做苹果公证。如果提示“已损坏”或“无法打开”，在终端运行一次
> `xattr -cr "/Applications/Git账号管家.app"`，或者右键应用 → **打开**。
> **Windows：** SmartScreen 可能提示“未知发布者”，点 **更多信息 → 仍要运行**。

## 快速上手

1. **账号**页 → 粘贴一个 token（比如 GitHub 的细粒度 token）。钥匙串里已有的账号和 SSH 密钥会自动出现。
2. **项目**页 → 把项目文件夹拖进窗口。
3. 点 **按建议绑定**，或者给每个项目选账号。
4. 完成。之后照常在命令行、IDE 或 Sourcetree 里拉取 / 推送，每个项目都会用自己的账号。

## token 还是 SSH？

Git 连接远程仓库只有两种方式：

| | HTTPS + token（或密码） | SSH + 密钥 |
|---|---|---|
| 是什么 | 网站上生成的一串字符，相当于可以限定权限的密码 | 自己电脑生成的一对文件：私钥留在本机，公钥登记到网站 |
| 项目地址 | `https://github.com/用户/仓库.git` | `git@github.com:用户/仓库.git` |
| 存在哪 | 钥匙串 / 凭据管理器 | `~/.ssh` |
| 会过期吗 | 可以设到期时间 | 不过期，除非在网站上删掉公钥 |
| 权限范围 | 可以只给某几个仓库（GitHub 细粒度 token） | 账号能访问的所有仓库 |
| 有代理时 | 走 443 端口，一般都通 | 走 22 端口，常被代理拦（可改走 443，或在代理里放行） |

用网站密码登录、在 Sourcetree 里 OAuth 授权，本质上都属于 HTTPS，最后存下来的还是 token 或密码。

## 配合 Sourcetree 使用

- **SSH 项目**：在 Sourcetree 里直接可用，会沿用工具给项目指定的密钥。
- **HTTPS 项目**：Sourcetree 自带的 Git 用它自己的账户，不读钥匙串。在 **设置 → Git → 使用系统 Git** 里切换后，Sourcetree 就和本工具、命令行共用同一套凭据。

## 从源码构建

```bash
git clone https://github.com/50kg/git-account-manager.git
cd git-account-manager
npm install
npm start              # 开发运行
npm run dist:mac       # 打包 .dmg
npm run dist:win       # 打包 .exe（在 macOS 上也能打）
```

国内网络可以先设置镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm install --registry=https://registry.npmmirror.com
```

代码结构：`src/core.js` 是全部逻辑（Git、密码库、token 识别、SSH），`src/main.js` 是 Electron 主进程，`renderer/` 是界面。除 Electron 外没有任何运行时依赖。

## 路线图

- [ ] 英文界面（多语言）
- [ ] Linux 版本
- [ ] 代码签名 / 苹果公证
- [ ] 自动更新
- [ ] 一键上传公钥支持更多平台（Bitbucket、Azure DevOps）

欢迎提建议和 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

凭据只会发给你正在访问的 Git 平台，不会发到其它任何地方。详情和漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © 50kg。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
GitHub、Gitee、GitLab、Sourcetree 是各自所有者的商标，本项目与它们没有关联。
