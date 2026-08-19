# 🚀 dsh-subagent-codex

> 让 DeepSeek Harness 里的 agent，把活儿丢给真正的 OpenAI Codex 去干。

[English](README_EN.md) | 中文

---

## 一句话说清楚

这是一个 DSH 插件。装上它，你的 DSH 会话里会多一个 `subagent_codex` 工具——你（或你的主 agent）把任务扔给它，它就在你本机的 **Codex CLI** 里独立跑一遍，再把结果拿回来。任务在 Codex 自己的环境里执行，用的是 Codex 的模型和工具链，跟 DSH 主对话完全隔离。

**简单说：DSH 负责统筹，Codex 负责干活。**

## 什么时候用它？

举几个真实场景（都是有点分量的活儿，Codex 很擅长）：

- **职场：竞品调研** —— `让 codex 帮我做一份竞品分析：把市面上 3 款主流笔记软件的定价、功能、优缺点都对比一遍，再结合我的使用场景给出选型建议，最后整理成一份能直接发给老板的汇报材料` —— Codex 自己上网查、横向对比、按你的需求给结论，回来就是一份能直接用的成品。
- **学习：把一个陌生领域彻底搞懂** —— `让 codex 帮我彻底搞懂"什么是区块链"：它会把这个问题拆成 5 个递进的小问题（是什么、怎么运作、解决了什么问题、和传统方案差在哪、有哪些争议），每个问题查多个来源交叉验证，用生活类比 + 图解 + 术语对照表讲清楚，最后输出一份带 FAQ 的完整学习文档` —— 这不再是"查个资料写篇文"：Codex 会像做研究一样系统地拆解、验证、组织，一次交付一份结构完整的深度学习材料。
- **创作：内容策划** —— `让 codex 帮我策划一篇小红书爆款笔记：给出 3 个选题方向，每个配上标题、开头钩子和正文大纲，再帮我搜集 5 条支撑素材` —— 一次调用给你整套创作方案，从选题到素材一步到位。
- **开发：跨模块改造** —— `让 codex 把用户认证从 JWT 迁移到 OAuth2：改鉴权中间件、补数据库迁移脚本、写单元测试和集成测试，全部跑通后整理成一份提交说明` —— 一整条开发流水线：动手改代码、补测试、跑通、总结，交付整套改动，你只负责 review。

**什么时候不适合用它**：任务需要在 DSH 内部完成时（比如要调用 DSH 的记忆、会话历史、其他 DSH 工具）——那种活儿留给普通 `subagent`。

## 快速开始

### 1. 前提

- 已安装 [Codex CLI](https://github.com/openai/codex) 并登录（`~/.codex/auth.json` 存在）。
- 已安装 DeepSeek Harness。

### 2. 安装

```bash
# 通过 dsh 插件命令安装（dsh.bundle 声明会自动把插件加进 bundle 栈）
dsh plugin --profile web add dsh-subagent-codex
# 或本地 tgz 安装
dsh plugin --profile web add file:/path/to/dsh-subagent-codex-0.1.1.tgz
```

### 3. 重启，开聊

重启 DSH 后新开一个会话，直接说：

```
让 codex 调研一下大语言模型推理加速的最新论文进展，整理成一篇带对比的综述
让 codex 子 agent 做 XX
```

工具名是 `subagent_codex`，每次调用 = 启动一次独立的 Codex CLI 任务。

## 配置

插件在配置树里注册两行：

| id | 作用 |
|---|---|
| `subagent-codex` | codex provider 插件行 |
| `tool-subagent-codex-enabled` | `subagent_codex` 工具行（one-shot） |

provider 行支持的配置项：

```yaml
- id: subagent-codex
  name: 'dsh-subagent-codex'
  config:
    command: codex            # codex CLI 可执行文件（PATH 名或绝对路径）
    cwd: /path/to/workdir     # 可选，子任务工作目录（缺省继承父会话 workspace）
    model: o3                 # 可选，指定模型（codex exec -m）
    sandbox: workspace-write  # 可选：read-only | workspace-write | danger-full-access
    timeoutMs: 600000         # 单次任务超时（毫秒）
    maxOutputChars: 40000     # 返回给委派方的输出上限
```

## 工作原理（技术细节）

- 插件实现 DSH 的 **SubagentProvider** 接口（`@deepseek-ai/dsh-subagent` 的 out-of-process 契约），注册名为 `codex` 的 provider。
- 因为是外部进程，provider **不声明任何 start 能力**（`NO_START_CAPABILITIES`）：外部 CLI 无法强制执行 `outputSchema` / `maxDepth` / `toolFilter` / `persona`。
- 每次委派 `spawn` 一次 `codex exec --json --skip-git-repo-check <prompt>`，解析 JSONL 事件流，取最后一条 `agent_message` 文本作为最终输出。
- 支持取消（AbortSignal → SIGKILL）、超时、输出截断。结果永远 resolve（正常 / 中止 / 失败都解析为终态），不会把异常抛给主对话。

### 可追溯性：每次运行都有完整记录

插件**不带 `--ephemeral`**，所以每次调用 Codex 都会把完整会话写到磁盘：

```
~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<session-id>.jsonl
```

这个文件里是这次任务的完整对话（输入、Codex 的中间过程、最终输出）。你可以：
- 用 `codex resume` 找回这个会话继续聊；
- 需要长期归档时执行 `codex archive <session-id>`，会移入 `~/.codex/archived_sessions/`。

## 常见问题

**Q: 为什么 DSH 侧边栏看不到 codex 子 agent 的运行记录？**
A: 设计如此。DSH 的侧边栏子 agent 树只显示 DSH 内部子 agent（有 DSH 会话）。Codex 是外部进程 provider，运行时不创建 DSH 会话，所以 GUI 里不显示。想看运行过程，去上面说的 `~/.codex/sessions/` 目录。

**Q: 需要装 Codex 的桌面 app 吗？**
A: 不需要。插件直接调用 `codex` CLI。桌面 app 装不装都不影响。

**Q: 会消耗我的 OpenAI 额度吗？**
A: 会。每次调用都用你 `~/.codex` 登录的账号跑 Codex，消耗的是 Codex 的 token 额度。

## License

MIT
