# 🚀 dsh-subagent-codex

> Let agents in DeepSeek Harness hand real work off to OpenAI Codex.

[English](README_EN.md) | 中文

---

## What it is, in one line

A DSH plugin that adds a `subagent_codex` tool to your Harness sessions. You — or your main agent — hand it a task, and it runs that task **in your local Codex CLI**, completely isolated from the main conversation, then brings the result back. Codex runs with its own model, its own toolchain, its own working directory.

**In short: DSH orchestrates, Codex executes.**

## When to use it

A few real-world examples (the kind of heavier work Codex excels at):

- **Workplace: competitive research** — *"Have codex run a competitor analysis: compare pricing, features, and pros/cons of 3 mainstream note-taking apps, then recommend one for my use case, formatted as a report I can send to my boss"* — Codex researches online, compares across dimensions, and delivers a ready-to-use document.
- **Learning: master an unfamiliar topic** — *"Have codex help me truly understand blockchain: break the question into 5 progressive sub-questions (what it is, how it works, what problem it solves, how it differs from traditional systems, what the controversies are), cross-check each one against multiple sources, explain with everyday analogies, diagrams, and a glossary, and deliver a complete study document with an FAQ"* — This is not "look it up and write an article": Codex approaches it like research — systematically breaking down, verifying, and organizing — and delivers a deep, well-structured learning package in one go.
- **Creation: content planning** — *"Have codex plan a viral Xiaohongshu post: 3 topic directions, each with a title, a hook, and a body outline, plus 5 supporting sources"* — one call delivers a full creation plan, from topic to material.
- **Development: cross-module refactoring** — *"Have codex migrate user auth from JWT to OAuth2: update the auth middleware, add database migration scripts, write unit and integration tests, run everything green, then summarize the changes as a commit message"* — a complete dev pipeline: edit code, add tests, run them, and summarize; you just review the whole change set.

**When NOT to use it**: tasks that must stay inside DSH (calling DSH memory, session history, or other DSH tools). Leave those to a regular `subagent`.

## Quick start

### 1. Prerequisites

- [Codex CLI](https://github.com/openai/codex) installed and logged in (`~/.codex/auth.json` exists).
- DeepSeek Harness installed.

### 2. Install

```bash
# via the dsh plugin command (the dsh.bundle declaration auto-mounts the plugin)
dsh plugin --profile web add dsh-subagent-codex
# or from a local tarball
dsh plugin --profile web add file:/path/to/dsh-subagent-codex-0.1.1.tgz
```

### 3. Restart and talk

Restart DSH and open a new session, then just say:

```
Have codex research the latest papers on LLM inference acceleration and summarize them into a comparative review
Have the codex subagent do X
```

The tool is named `subagent_codex`; each invocation starts one independent Codex CLI task.

## Configuration

The plugin registers two rows in the config tree:

| id | purpose |
|---|---|
| `subagent-codex` | the codex provider row |
| `tool-subagent-codex-enabled` | the `subagent_codex` tool row (one-shot) |

Supported config keys on the provider row:

```yaml
- id: subagent-codex
  name: 'dsh-subagent-codex'
  config:
    command: codex            # codex CLI executable (PATH name or absolute path)
    cwd: /path/to/workdir     # optional; child working dir (defaults to parent session workspace)
    model: o3                 # optional; model override (codex exec -m)
    sandbox: workspace-write  # optional: read-only | workspace-write | danger-full-access
    timeoutMs: 600000         # per-task timeout in ms
    maxOutputChars: 40000     # output cap returned to the delegating agent
```

## How it works (technical details)

- The plugin implements the DSH **SubagentProvider** seam (`@deepseek-ai/dsh-subagent`, out-of-process contract) and registers a provider named `codex`.
- Being an external process, the provider advertises **no start capabilities** (`NO_START_CAPABILITIES`): an external CLI cannot honor `outputSchema` / `maxDepth` / `toolFilter` / `persona`.
- Each delegation `spawn`s one `codex exec --json --skip-git-repo-check <prompt>`, parses the JSONL event stream, and takes the last `agent_message` text as the final output.
- Cancellation (AbortSignal → SIGKILL), timeout, and output truncation are supported. Results always resolve (completed / aborted / error all settle to a terminal state), so failures never blow up the main conversation.

### Traceability: every run leaves a full record

The plugin deliberately does **not** pass `--ephemeral`, so every Codex invocation persists its complete session to disk:

```
~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<session-id>.jsonl
```

That file holds the full conversation (input, Codex's intermediate steps, final output). You can:

- recover the session with `codex resume` and keep talking to it;
- archive it long-term with `codex archive <session-id>` (moves it to `~/.codex/archived_sessions/`).

## FAQ

**Q: Why don't I see codex subagent runs in the DSH sidebar?**
A: By design. The DSH sidebar subagent tree only lists DSH-internal subagents (those backed by a DSH session). Codex is an out-of-process provider — it never creates a DSH session at runtime — so the GUI does not show it. To watch a run, look at `~/.codex/sessions/` as described above.

**Q: Do I need the Codex desktop app?**
A: No. The plugin calls the `codex` CLI directly. The desktop app is irrelevant.

**Q: Does this consume my OpenAI quota?**
A: Yes. Every invocation runs Codex with the account your `~/.codex` is logged in as, consuming Codex token quota.

## License

MIT
