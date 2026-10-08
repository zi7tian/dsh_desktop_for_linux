# DeepSeek Harness Desktop for Linux

这是 Linux x86_64 桌面端的独立打包仓库，生成 **DEB、RPM、Arch Linux `.pkg.tar.zst`** 三种安装包。下载已构建版本请到 [Releases](https://github.com/zi7tian/dsh_desktop_for_linux/releases)。

应用源码来自 [DeepSeek 官方仓库](https://github.com/deepseek-ai/deepseek-harness)，以固定提交的 Git 子模块引用。此仓库只维护打包入口、Linux 桌面适配补丁、构建配置和发布清单；上游开发历史不属于本仓库的提交历史。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `upstream/` | 上游子模块，固定到 `upstream.lock.json` 中的提交 |
| `patches/linux-desktop.patch` | 已发布桌面版本的改动，包括 Linux 启动、三种安装格式、桌面/Web profile 插件迁移及对应测试和文档 |
| `scripts/desktop.py` | 准备源码、核对补丁、调用构建并收集安装包 |
| `.env.linux.example` | 应用标识与 npm 镜像配置示例，不包含账号凭据 |
| `releases/` | 发布版本的安装包大小与 SHA-256 记录 |
| `.work/source/` | 自动生成的构建副本，Git 忽略 |
| `dist/` | 构建输出，Git 忽略 |

构建副本的完整 Git tree 必须与锁文件记录一致。重复准备不会重置文件；发现额外修改时会停止，避免覆盖本地工作。`upstream/` 保持原始状态，补丁只应用到 `.work/source/`。

## 构建

需要 Linux x86_64、Git、Python 3.10+、Node.js（建议 24 LTS）、pnpm 11.7.0，以及 `rpmbuild`、`tar`、`xz`、`zstd`。编译工具和系统运行库按上游开发环境要求安装；构建会下载 Electron、Node/Python 运行时、npm 依赖和目标平台原生库，需要网络和足够的磁盘空间。不支持 ARM。

```sh
git clone https://github.com/zi7tian/dsh_desktop_for_linux.git
cd dsh_desktop_for_linux
python3 scripts/desktop.py prepare
# 可选：复制后修改应用标识或 npm 镜像
cp .env.linux.example .env.linux
python3 scripts/desktop.py build
```

脚本自动初始化固定版本的子模块，校验补丁和源码树，执行上游 `pnpm install --frozen-lockfile` 与 `pnpm run package:desktop:linux:x64`。构建包含上游运行时检查；三个安装包、`SHA256SUMS` 和 `build-info.json` 写入 `dist/`。它不会安装应用、上传文件、创建标签或读取 GitHub 凭据。打包日志和中间结果位于 `.work/source/apps/desktop/.desktop-build/`。

仅校验打包仓库及源码组合：

```sh
python3 -m unittest discover -s tests -v
python3 scripts/desktop.py verify
```

更新上游时，需共同更新子模块提交、补丁及锁文件中的提交、补丁 SHA-256 和应用补丁后的 Git tree，再验证构建。不要直接修改 `upstream/` 或把生成的构建副本提交进本仓库。

## 安装与兼容性

安装包只面向 x86_64，内置应用所需 Node/Python 运行时，要求 glibc ≥ 2.32。按发行版选择安装包：

```sh
sudo apt install ./deepseek-harness-*-linux-amd64.deb
sudo dnf install ./deepseek-harness-*-linux-x86_64.rpm
sudo pacman -U ./deepseek-harness-*-linux-x86_64.pkg.tar.zst
```

三个命令分别用于 Debian/Ubuntu、RPM 系发行版和 Arch 系发行版，只执行适合自己系统的一条。Linux 安装包未签名，使用手动安装新版本的方式更新。桌面端与 Web 端使用独立 profile，共享受支持的用户数据。

`v0.2.0-rc.2-linux.1` 的安装包保留原发布内容，不因仓库结构调整而替换。已在 Arch 主机验证桌面启动、模型和工具调用、内置运行时及 GPU 状态；未在独立 Debian/RPM 主机实装验证。该版本的 Arch 包 `.MTREE` 属主记录与安装属主不一致，`pacman -Qkk` 会产生 UID/GID 告警，已核实不存在内容校验错误；这项打包元数据问题仍待修复。

## 署名与许可证

本仓库维护者为 [zi7tian](https://github.com/zi7tian)，打包仓库的提交可包含 `Codex <codex@openai.com>` 的 co-author 署名。上游实现及相应补丁的原始版权仍归其作者；上游 MIT 许可证保存在 [licenses/DeepSeek-MIT.txt](licenses/DeepSeek-MIT.txt)。本仓库新增打包脚本按 [MIT](LICENSE) 许可发布。
