/**
 * dsh-subagent-codex — an out-of-process subagent provider for DeepSeek
 * Harness that delegates each task to the OpenAI Codex CLI (`codex exec`).
 *
 * The provider follows the seam contract from
 * `@deepseek-ai/dsh-subagent/out-of-process`: it advertises no start-time
 * capabilities (an external CLI cannot honor parent-enforced
 * outputSchema/maxDepth/toolFilter/persona), resolves the child working
 * directory from config or the delegating parent session, and publishes the
 * standard subprocess run handle whose result never rejects.
 *
 * @module dsh-subagent-codex
 */
import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  NO_START_CAPABILITIES,
  SubagentRunId,
  assertPositiveFinite,
  resolveChildCwd,
  settleRunResult,
  subprocessRunHandle,
  validateConfiguredCwd
} from "@deepseek-ai/dsh-subagent";

const name = "dsh-subagent-codex";
const inject = ["subagents"];
const prefix = "dsh-subagent-codex";

const Config = z.object({
  /** The codex CLI executable (name on PATH or an absolute path). */
  command: z.string().default("codex"),
  /** Working directory override for the child. Omit to inherit the parent session cwd. */
  cwd: z.string(),
  /** Model override, e.g. `o3` or `gpt-5`. Passed as `codex exec -m <model>`. */
  model: z.string(),
  /** Codex sandbox policy: read-only | workspace-write | danger-full-access. */
  sandbox: z.string(),
  /** Hard wall-clock bound for one delegated task, in milliseconds. */
  timeoutMs: z.number().default(10 * 60 * 1000),
  /** Cap on the captured output characters returned to the delegating agent. */
  maxOutputChars: z.number().default(40000)
});

/**
 * Extract the final assistant text from codex `--json` JSONL output.
 *
 * Codex emits a JSONL event stream; the last `item.completed` event whose
 * item is an `agent_message` carries the final answer. Anything malformed is
 * skipped defensively.
 * @param jsonl - raw stdout.
 * @returns the trimmed final text, or "" when nothing was produced.
 */
function collectCodexText(jsonl) {
  let text = "";
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event?.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
      text = event.item.text;
    }
  }
  return text.trim();
}

class CodexProvider {
  constructor(config) {
    this.config = config;
  }

  name = "codex";
  /** External CLI cannot honor parent-enforced start features. */
  capabilities = NO_START_CAPABILITIES;
  inheritsParentContext = false;

  start(request) {
    assertPositiveFinite(prefix, "timeoutMs", this.config.timeoutMs);
    const configuredCwd = validateConfiguredCwd(prefix, this.config.cwd);
    const parentCwd = request.parent?.session?.header?.cwd;
    const cwd = resolveChildCwd(prefix, configuredCwd, parentCwd);

    const promptText = (request.prompt ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const signal = request.signal;
    let cancelled = false;
    let child;
    let stdoutChunks = "";
    let stderrTail = "";

    const attempt = () => new Promise((resolve) => {
      const args = ["exec", "--json", "--skip-git-repo-check"];
      if (this.config.model) args.push("-m", this.config.model);
      if (this.config.sandbox) args.push("-s", this.config.sandbox);
      args.push(promptText);

      const env = {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1"
      };
      child = spawn(this.config.command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const timer = setTimeout(() => {
        cancelled = true;
        child?.kill("SIGKILL");
      }, this.config.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdoutChunks += chunk.toString();
        if (stdoutChunks.length > this.config.maxOutputChars * 4) {
          stdoutChunks = stdoutChunks.slice(-this.config.maxOutputChars * 4);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-4000);
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          output: [],
          stopReason: "error",
          error: error.message
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const text = collectCodexText(stdoutChunks);
        if (cancelled) {
          resolve({
            output: text ? [{ type: "text", text }] : [],
            stopReason: "aborted"
          });
          return;
        }
        if (code !== 0 && !text) {
          resolve({
            output: stderrTail ? [{ type: "text", text: stderrTail }] : [],
            stopReason: "error"
          });
          return;
        }
        resolve({
          output: text ? [{ type: "text", text: text.slice(0, this.config.maxOutputChars) }] : [],
          stopReason: "completed"
        });
      });
    });

    const onAbort = () => {
      cancelled = true;
      child?.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort);

    const parts = {
      id: SubagentRunId(randomUUID()),
      signal,
      onAbort,
      attempt,
      collectOutput: () => {
        const text = collectCodexText(stdoutChunks);
        return text ? [{ type: "text", text: text.slice(0, this.config.maxOutputChars) }] : [];
      },
      cancelled: () => cancelled,
      requestCancel: () => {
        cancelled = true;
        child?.kill("SIGKILL");
      },
      teardown: async () => {
        if (child && child.exitCode === null) {
          child.kill("SIGKILL");
          await new Promise((release) => child.once("close", release));
        }
      }
    };
    return subprocessRunHandle({
      ...parts,
      result: settleRunResult(parts)
    });
  }
}

function apply(ctx, config) {
  ctx.subagents.registerProvider(new CodexProvider(config));
}

export { Config, apply, inject, name };
