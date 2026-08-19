# dsh-subagent-codex

DSH 子 agent provider 插件：把任务委派给 OpenAI Codex CLI（`codex exec`），在 DSH 中暴露 `subagent_codex` 工具。

## 功能

- 注册名为 `codex` 的子 agent provider（外部进程，`inheritsParentContext: false`）。
- 暴露 `subagent_codex` 工具：向 agent 提供委派入口，任务在独立的 Codex CLI 进程中执行。
- 子 agent 工作目录继承委派方会话的 workspace（可配置 `cwd` 覆盖）。
- 支持取消（abort）、超时（`timeoutMs`）、输出截断（`maxOutputChars`）。

## 安装

```bash
# 从 npm 或本地 tgz 安装（dsh.bundle 声明会自动把插件加进 bundle 栈）
dsh plugin --profile web add dsh-subagent-codex
# 或本地安装
dsh plugin --profile web add file:/path/to/dsh-subagent-codex-0.1.0.tgz
```

安装后重启 DSH，新会话即可使用 `subagent_codex` 工具。

## 配置

插件的 patch 层在配置树中注册两行：

| id | 作用 |
|---|---|
| `subagent-codex` | codex provider 插件行，config 见下 |
| `tool-subagent-codex-enabled` | `subagent_codex` 工具行（provider: codex，one-shot） |

provider 行支持的 config：

```yaml
- id: subagent-codex
  name: 'dsh-subagent-codex'
  config:
    command: codex            # codex CLI 可执行文件（PATH 名或绝对路径）
    cwd: /path/to/workdir     # 可选，子 agent 工作目录（缺省继承父会话 cwd）
    model: o3                 # 可选，codex exec -m
    sandbox: workspace-write  # 可选：read-only | workspace-write | danger-full-access
    timeoutMs: 600000         # 单次任务超时（毫秒）
    maxOutputChars: 40000     # 返回给委派方的输出上限
```

## 工作原理

- provider 遵循 `@deepseek-ai/dsh-subagent/out-of-process` 契约：不声明任何 start 能力（外部 CLI 无法强制执行 outputSchema / maxDepth / toolFilter / persona），结果永远不会 reject（正常/中止/失败都解析为终态结果）。
- 每次委派 spawn 一次 `codex exec --json --skip-git-repo-check --ephemeral <prompt>`，解析 JSONL 事件流，取最后一条 `agent_message` 文本作为最终输出。
- 依赖 `~/.codex/auth.json` 中已有的 Codex 登录态。

## 开发

```bash
npm pack    # 生成 dsh-subagent-codex-0.1.0.tgz
```

## License

MIT
