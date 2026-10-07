# Agent Note: 在 Web 与 Desktop profile 之间迁移插件

Status: implemented

[English](2026-10-02-profile-plugin-migration.md) | 中文

## 问题

Web 与 Desktop 把插件分别保存在 `$DSH_HOME/profiles` 下各自的 profile 中。两个外壳共用同一套组合包模板——`apps/desktop/src/project-manager.ts` 用 `PROFILE_TEMPLATES.web` 初始化保留的 Desktop profile——因此同一个插件可以服务两边，但在一个外壳中安装它的人不会在另一个外壳里拥有它。直接复制 profile 目录并不可行：`.dsh-module-fallback` 保存的是绝对符号链接，锁文件钉住 registry URL、完整性哈希与平台，而 Desktop profile 是按应用内置的运行时 Node 而非系统 Node 安装的。[当前 profile 的插件管理](../architecture/2026-09-14-current-profile-plugin-management.zh.md)让保留的 Desktop profile 能通过应用安装、移除和启用插件，但没有任何办法把一组插件带过去。

## 决定

`packages/boot/plugin-manager/src/migrate.ts` 中的 `planProfilePluginMigration`（以 `@deepseek-ai/dsh-plugin-manager/migrate` 发布）把来源 profile 的清单转成一份只做新增的计划。它按清单顺序遍历来源的 dependencies，跳过不声明组合包补丁的包、来源保持禁用的包，以及目标已经拥有的包；其余成为安装项。`migrationSpec` 把 registry 依赖钉在来源正在运行的版本上，使目标无法解析到更新的版本；而路径、git、tarball 或别名形式的记录保持原样，因为改写它会安装到另一个产物。来源激活而目标缺少的组合包，随后会在来源安装或本次 dsh 安装提供它们时加入目标的组合包列表；由本次安装提供的组合包无需安装即可启用。

`dsh plugin --profile <target> migrate --from <source> [--dry-run]` 在 `apps/cli/src/plugin.ts` 中执行这份计划。它用 `PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES` 创建缺失的目标 profile，保留的 Desktop profile 除外——那个 profile 归应用所有：命令要求应用已经初始化它，并在迁移期间完全退出。安装先执行，期间暂停组合包协调，因此新安装的包不会在运行中途自行激活；随后按来源顺序把新增的组合包写入目标。`--dry-run` 只打印计划，不做任何更改。迁移只做新增：它不停用、不替换、不删除任何东西，同一对 profile 的第二次运行会报告没有可迁移项。作为目标时，保留 profile 通过 Desktop 应用自身的启动器接受这个子命令（该启动器设置 `manageDesktopProfile`，因此不受 CLI 对 desktop profile 启动命令的拒绝约束）；从该 profile 迁出则使用普通 CLI。

## 考虑过的替代方案

**直接复制 profile 目录。** 复制品带着绝对回退符号链接、钉在来源机器 registry 上的锁文件、完整性哈希与平台信息，以及为另一种 Node ABI 构建的模块，因此在系统 Node 外壳与内置 Node 外壳之间不可移植。

**按来源清单记录的版本范围重新安装。** `^1.0.0` 这样的范围会解析到最新版本，而不是来源实际运行的版本，因此迁移后的目标可能在比当事人验证过的更新的插件上失败。

**用来源的插件集合替换目标的插件集合。** 迁移会因此停用、移除并重装目标本来就有的插件，从被要求补足的 profile 中拿走已有的工作。

**通过 Web 插件管理器暴露来源 profile。** Web 界面一次只管理一个 profile，该操作因此必须在共享客户端中挂载第二个 profile，而迁移是一次性的 profile 到 profile 的动作，CLI 本就持有 profile 参数。

## 后果

- 迁移是单次来源到目标的运行，并且幂等：重复同一对 profile 会报告没有可迁移项。
- 安装就是一次普通的内置 pnpm 安装到目标 profile；失败时按 profile runner 既有行为恢复目标的 manifest、锁文件与 node_modules。
- 来源记录为路径、git 或 tarball 的插件带着该记录到达；registry 依赖则钉在来源运行的版本上。
- 本次安装提供的组合包在目标中直接启用而不必安装，这与 profile 列出安装自带的可选组合包的方式一致。
