# Agent Note: 为 Linux 打包桌面应用

Status: implemented

[English](2026-10-02-linux-desktop-release-target.md) | 中文

## 问题

桌面发布流水线在目标表、产物命名模式以及运行时准备与 electron-builder 阶段都只列出一组封闭平台——macOS arm64/x64 与 Windows x64——因此 Linux x86_64 主机根本无法产出桌面产物。[打包并更新 Electron 桌面应用](2026-08-25-electron-desktop-packaging-and-updates.zh.md)把这一缺失记录为决定，而不是疏漏。补上它的工作是打包而非移植，原因有两点：primary-runtime 载荷本就解析 linux-x64 平台，而 Electron 自带的 Node 链接了一个在 Linux 上崩溃的 libvips 构建，因此载荷必须在[桌面内置运行时与外部插件](2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md)所述的 primary-runtime Node 下运行。

## 决定

`linux-x64` 与其他平台一样是一个打包目标。`apps/desktop/scripts/package-target.ts` 把它映射为 `--linux`/`--x64`，拒绝在非 Linux x86_64 主机上运行，并跳过发布记录，因为 AppImage 没有可上传的更新 feed；`apps/desktop/scripts/desktop-upload-plan.ts` 出于同样原因把它排除在上传目标之外。固定命令为 `package:linux:x64` 与 `package:linux:x64:dir`，在仓库根以 `package:desktop:linux:x64` 和 `package:desktop:linux:x64:dir` 暴露。

Linux 不携带更新 feed，也不携带强制更新策略。`apps/desktop/scripts/electron-builder-config.mjs` 只在非 Linux 时计算 `policy` 与 `update`；写入任何一项都会让启动中止，因为 `apps/desktop/src/main.ts` 会以 `desktop policy: unsupported platform` 拒绝 `win32` 与 `darwin` 之外的平台，而且发布频道不提供 Linux 产物。Linux 条目就是应用本身：未签名、`AppImage`、`executableName` 为 `deepseek-harness`、类别 `Development`，以替换而非就地更新。

Linux 包不使用 ASAR：`asar: resolvedPlatform !== 'linux'`，因为载荷在无法读取 ASAR 归档的内置 Node 下运行。因此载荷落在 `resources/app/dsh`，随附启动器与私有 Host 从载荷根目录推导支持目录，而不再假定归档——见 `apps/desktop-host/src/cli.ts` 的 `desktopRuntimeSupportDir`，它经由 macOS 与 Windows 布局所用的同一 `resources/runtime` 树访问。

平台准备随新目标扩展。`prepare-runtime.ts`、`prepare-dsh.ts` 与 `prepare-cli.ts` 映射 Linux，为所有非 Windows 平台标记启动器可执行，工具链预检探测 Linux kit；由于不存在 linux-x64 的 LibreOffice kit，Linux 选择 `wasm` 办公引擎。`desktop-package-environment.mjs` 在 Linux 上只读取共享键，来源是新的 `apps/desktop/.env.linux.example` 所记录的同一个 `.env.linux` 文件。Linux 向账号服务报告 Web 客户端身份：`apps/desktop/src/main.ts` 对 `win32` 与 `darwin` 之外的平台传 `null`，账号层把它记录为 Web 身份；shell 命令安装仍仅限 macOS 与 Windows，只在有人请求时报告 `EUNSUPPORTED`。

## 考虑过的替代方案

**在 Linux 上写入强制更新策略与 electron-updater feed。** `apps/desktop/src/main.ts` 在任何窗口存在前就拒绝不支持的平台，因此携带该策略的 Linux 构建会在启动时中止，而厂商 feed 也没有可指向的 Linux 频道。

**报告专门的 `desktop-linux` 账号客户端身份。** 账号线路协议没有这样的头部，而 `null` 平台已经是被记录的 Web 身份，桌面应用会因此声称一个服务无法与未知调用者区分开的客户端。

**在 Linux 上保留 ASAR 布局。** 打包后的载荷在无法读取 ASAR 归档的内置 Node 下运行，应用必须在 Host 首次启动前解包或自行实现归档访问。

**把 Linux 当作从 macOS 或 Windows 交叉编译的目标。** linux-x64 运行时载荷必须在运行它的主机上准备并冒烟验证，因此打包脚本拒绝非 Linux-x64 主机，而不是产出无人验证过的产物。

## 后果

- Linux x86_64 主机产出 `deepseek-harness-0.2.0-rc.2-linux-x86_64.AppImage`；electron-builder 在 Linux 上把 ${arch} 展开为 `x86_64`，产物命名模式与桌面文档都接受这一点。
- 产物未签名且没有更新器：新版本就是新的 AppImage，不会有任何东西改写已安装的那份。
- 挂载它需要 FUSE 2 运行时；没有该库的主机可加 `--appimage-extract-and-run` 启动应用，或使用未打包目录。
- 应用在 Linux 上报告 Web 客户端身份，把 `dsh` 命令安装进 shell 在那里仍不受支持。
