#!/usr/bin/env node

// Modified from codex-image-in-cc by KingGyuSuh (Apache-2.0).
// Changes: role-labelled visual inputs, audit/design/compare delegation,
// deterministic report collection, and Claude-readable result markers.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_NODE_VERSION = "18.18.0";
const MIN_CODEX_VERSION = "0.142.0";
const MAX_ATTACHED_IMAGES = 5;
const MODES = new Set(["auto", "audit", "design", "compare"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_PATH = path.resolve(SCRIPT_DIR, "../references/codex-visual-protocol.md");

function resolveCodex() {
  if (process.platform !== "win32") {
    return { command: "codex", prefix: [] };
  }

  const whereResult = spawnSync("where.exe", ["codex.cmd"], {
    encoding: "utf8",
    windowsHide: true
  });
  const cmdPath = String(whereResult.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (cmdPath) {
    const jsPath = path.join(
      path.dirname(cmdPath),
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js"
    );
    if (fs.existsSync(jsPath)) {
      return { command: process.execPath, prefix: [jsPath] };
    }
  }

  return { command: "codex.cmd", prefix: [] };
}

const CODEX = resolveCodex();

function parseSemver(text) {
  const match = String(text ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map((part) => Number.parseInt(part, 10)) : null;
}

function compareSemver(a, b) {
  const left = Array.isArray(a) ? a : parseSemver(a);
  const right = Array.isArray(b) ? b : parseSemver(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function splitFirstToken(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { token: null, rest: "" };

  const quoted = text.match(/^(["'])((?:\\.|(?!\1).)+)\1(?:\s+([\s\S]+))?$/);
  if (quoted) {
    return { token: quoted[2], rest: (quoted[3] ?? "").trim() };
  }

  const unquoted = text.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  return unquoted
    ? { token: unquoted[1], rest: (unquoted[2] ?? "").trim() }
    : { token: null, rest: "" };
}

const ROLE_FLAGS = new Map([
  ["--target", "target"],
  ["--candidate", "candidate"],
  ["--ref", "reference"],
  ["--reference", "reference"],
  ["--image", "target"]
]);

function takeRequiredValue(flag, rest) {
  const next = splitFirstToken(rest);
  if (!next.token || next.token.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return next;
}

function parseStudioArguments(raw) {
  let rest = String(raw ?? "").trim();
  let mode = "auto";
  // 不传 = 沿用 ~/.codex/config.toml 的 model（默认行为不变）
  let model = null;
  let out = null;
  const images = [];

  while (rest) {
    const first = splitFirstToken(rest);
    const token = first.token;
    if (!token) break;

    if (token === "--") {
      rest = first.rest;
      break;
    }

    if (token === "--mode") {
      const next = takeRequiredValue(token, first.rest);
      mode = next.token.toLowerCase();
      rest = next.rest;
      continue;
    }

    if (token.startsWith("--mode=")) {
      mode = token.slice("--mode=".length).toLowerCase();
      rest = first.rest;
      continue;
    }

    if (token === "--out") {
      const next = takeRequiredValue(token, first.rest);
      out = next.token;
      rest = next.rest;
      continue;
    }

    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      rest = first.rest;
      continue;
    }

    if (token === "--model") {
      const next = takeRequiredValue(token, first.rest);
      model = next.token;
      rest = next.rest;
      continue;
    }

    if (token.startsWith("--model=")) {
      model = token.slice("--model=".length);
      rest = first.rest;
      continue;
    }

    if (ROLE_FLAGS.has(token)) {
      const next = takeRequiredValue(token, first.rest);
      images.push({ role: ROLE_FLAGS.get(token), input: next.token });
      rest = next.rest;
      continue;
    }

    const equalsMatch = token.match(/^(--target|--candidate|--ref|--reference|--image)=(.+)$/);
    if (equalsMatch) {
      images.push({ role: ROLE_FLAGS.get(equalsMatch[1]), input: equalsMatch[2] });
      rest = first.rest;
      continue;
    }

    break;
  }

  if (!MODES.has(mode)) {
    throw new Error(`Unsupported mode "${mode}". Use auto, audit, design, or compare.`);
  }
  if (images.length > MAX_ATTACHED_IMAGES) {
    throw new Error(`Too many images (${images.length}); attach at most ${MAX_ATTACHED_IMAGES}.`);
  }

  return { mode, model, out, images, brief: rest.trim() };
}

function resolveImages(images, cwd) {
  return images.map(({ role, input }) => {
    const absolutePath = path.resolve(cwd, input);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Image not found: ${absolutePath}`);
    }
    if (!fs.statSync(absolutePath).isFile()) {
      throw new Error(`Image path is not a file: ${absolutePath}`);
    }
    return { role, path: absolutePath };
  });
}

function timestampForFile(date = new Date()) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

// 产物根目录的取法，按优先级：
//   1. `--out <dir>`            调用者显式指定
//   2. 环境变量 CODEX_VISUAL_OUT
//   3. cwd 下存在 ai/design_system/ → ai/design_system/codex-visual/
//      （用户跨项目的约定：视觉素材统一归设计系统目录管）
//   4. 否则退回 cwd/codex-visual/（与上游一致）
function resolveOutputRoot(cwd, explicit) {
  if (explicit) return path.resolve(cwd, explicit);
  if (process.env.CODEX_VISUAL_OUT) return path.resolve(cwd, process.env.CODEX_VISUAL_OUT);
  const ds = path.join(cwd, "ai", "design_system");
  if (fs.existsSync(ds)) return path.join(ds, "codex-visual");
  return path.join(cwd, "codex-visual");
}

function createOutputDirectory(cwd, date = new Date(), explicitOut = null) {
  const root = resolveOutputRoot(cwd, explicitOut);
  fs.mkdirSync(root, { recursive: true });
  const stem = timestampForFile(date);
  let candidate = path.join(root, stem);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${stem}-${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(candidate, { recursive: false });
  return candidate;
}

function inferExpectedMode(mode, images) {
  if (mode !== "auto") return mode;
  const candidateCount = images.filter((item) => item.role === "candidate").length;
  if (candidateCount >= 2) return "compare";
  return "auto";
}

function resolveReturnedMode(requestedMode, images, stdout) {
  if (requestedMode !== "auto") return requestedMode;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = line.match(/^MODE:\s*(audit|design|compare)\s*$/i);
    if (match) return match[1].toLowerCase();
  }
  return inferExpectedMode(requestedMode, images);
}

function buildInstruction({ mode, images, brief, outputDirectory, protocol }) {
  const inventory = images.length
    ? images.map((item, index) => `${index + 1}. [${item.role}] ${item.path}`).join("\n")
    : "No image attachments. Inspect any repository files named in the brief.";

  return `Follow the visual delegation protocol below. Complete the work yourself and return evidence, not a plan.

Requested mode: ${mode}
Output directory: ${outputDirectory}
Required report path: ${path.join(outputDirectory, "codex-report.md")}

Attached visual inventory (the same files are attached to this Codex turn):
${inventory}

For audit or comparison, inspect the pixels directly. Do not generate an image unless the brief asks for a redesign, annotation, or comparison board.
For design output, use the bundled imagegen skill and built-in image_gen tool only; do not use the CLI/API-key fallback.
Save every new artifact inside the output directory. Do not overwrite any source image.

--- PROTOCOL ---
${protocol}
--- END PROTOCOL ---

User and Claude brief:

${brief}`;
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true
  });
  return {
    available: !(result.error && result.error.code === "ENOENT"),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

function spawnCodex(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX.command, [...CODEX.prefix, ...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({ status: status ?? (signal ? 1 : 0), stdout, stderr });
    });
  });
}

function normalizePrintedPath(raw, cwd) {
  const cleaned = String(raw ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!cleaned) return null;
  const resolved = path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
  return fs.existsSync(resolved) ? path.resolve(resolved) : null;
}

function extractPrintedPaths(stdout, labels, cwd) {
  const wanted = new Set(labels.map((label) => label.toUpperCase()));
  const paths = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+):\s*(.+)$/i);
    if (!match || !wanted.has(match[1].toUpperCase())) continue;
    const resolved = normalizePrintedPath(match[2], cwd);
    if (resolved) paths.push(resolved);
  }
  return paths;
}

function findImageArtifacts(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(path.resolve(fullPath));
      }
    }
  }
  return found.sort();
}

function ensureReport({ outputDirectory, stdout, requestedMode, cwd }) {
  const requiredPath = path.join(outputDirectory, "codex-report.md");
  if (fs.existsSync(requiredPath)) return path.resolve(requiredPath);

  const printed = extractPrintedPaths(stdout, ["REPORT"], cwd)
    .find((item) => path.extname(item).toLowerCase() === ".md");
  if (printed) return printed;

  const fallback = [
    "# Codex visual report (transcript fallback)",
    "",
    `Requested mode: ${requestedMode}`,
    "",
    "Codex did not create the required structured report. The raw stdout transcript follows.",
    "",
    "````text",
    stdout.trim(),
    "````",
    ""
  ].join("\n");
  fs.writeFileSync(requiredPath, fallback, "utf8");
  return path.resolve(requiredPath);
}

function renderResultMarkers({ mode, reportPath, artifacts }) {
  const lines = [
    "",
    `CODEX_VISUAL_MODE: ${mode}`,
    `CODEX_VISUAL_REPORT: ${reportPath}`
  ];
  for (const artifact of artifacts) {
    lines.push(`CODEX_VISUAL_ARTIFACT: ${artifact}`);
  }
  return lines.join("\n");
}

async function handleRun(argv) {
  const raw = argv.join(" ").trim();
  let parsed;
  try {
    parsed = parseStudioArguments(raw);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!parsed.brief) {
    console.error("Usage: /codex-visual:studio [--mode auto|audit|design|compare] [--model <slug>] [--out <dir>] [--target <image> ...] [--candidate <image> ...] [--ref <image> ...] <brief>");
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  let images;
  try {
    images = resolveImages(parsed.images, cwd);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(PROTOCOL_PATH)) {
    console.error(`Error: Delegation protocol not found: ${PROTOCOL_PATH}`);
    process.exitCode = 1;
    return;
  }

  const outputDirectory = createOutputDirectory(cwd, new Date(), parsed.out);
  const protocol = fs.readFileSync(PROTOCOL_PATH, "utf8");
  const instruction = buildInstruction({
    mode: parsed.mode,
    images,
    brief: parsed.brief,
    outputDirectory,
    protocol
  });

  const codexArgs = ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check"];
  // `--model` 透传成 codex 的 `-m`。不传就不加这个参数 —— 让 codex 自己去读
  // `~/.codex/config.toml` 的 `model`，与本 flag 存在之前的行为逐字相同。
  if (parsed.model) {
    codexArgs.push("--model", parsed.model);
  }
  for (const image of images) {
    codexArgs.push("--image", image.path);
  }
  codexArgs.push("-C", cwd, "--", instruction);

  let result;
  try {
    result = await spawnCodex(codexArgs, cwd);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    process.exitCode = result.status;
    return;
  }

  const reportPath = ensureReport({
    outputDirectory,
    stdout: result.stdout,
    requestedMode: parsed.mode,
    cwd
  });
  const printedArtifacts = extractPrintedPaths(result.stdout, ["SAVED", "ARTIFACT"], cwd)
    .filter((item) => IMAGE_EXTENSIONS.has(path.extname(item).toLowerCase()));
  const artifacts = [...new Set([...findImageArtifacts(outputDirectory), ...printedArtifacts])];
  const mode = resolveReturnedMode(parsed.mode, images, result.stdout);
  console.log(renderResultMarkers({ mode, reportPath, artifacts }));
}

function buildStatusReport(cwd = process.cwd()) {
  const nodeCompare = compareSemver(process.versions.node, MIN_NODE_VERSION);
  const codexVersion = runSync(CODEX.command, [...CODEX.prefix, "--version"], { cwd });
  const codexText = (codexVersion.stdout || codexVersion.stderr).trim();
  const codexCompare = compareSemver(codexText, MIN_CODEX_VERSION);
  const codexOk = codexVersion.available && codexVersion.status === 0 && codexCompare !== null && codexCompare >= 0;
  const login = codexVersion.available
    ? runSync(CODEX.command, [...CODEX.prefix, "login", "status"], { cwd })
    : null;
  const loginText = login ? (login.stdout || login.stderr).trim() : "Codex unavailable";
  const help = codexVersion.available
    ? runSync(CODEX.command, [...CODEX.prefix, "exec", "--help"], { cwd })
    : null;
  const imageAttachmentOk = Boolean(help?.status === 0 && /(^|\s)(-i,\s*)?--image(\s|=|<|$)/.test(`${help.stdout}\n${help.stderr}`));
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const imagegenPath = path.join(codexHome, "skills", ".system", "imagegen", "SKILL.md");

  return {
    ready: Boolean(
      nodeCompare !== null && nodeCompare >= 0 && codexOk &&
      login?.status === 0 && imageAttachmentOk && fs.existsSync(imagegenPath) &&
      fs.existsSync(PROTOCOL_PATH)
    ),
    node: { version: process.versions.node, minimum: MIN_NODE_VERSION },
    codex: { version: codexText || "not found", minimum: MIN_CODEX_VERSION },
    login: loginText || "not logged in",
    imageAttachment: imageAttachmentOk,
    imagegenSkill: fs.existsSync(imagegenPath) ? imagegenPath : null,
    protocol: fs.existsSync(PROTOCOL_PATH) ? PROTOCOL_PATH : null
  };
}

function handleStatus() {
  const report = buildStatusReport();
  console.log("Codex Visual status");
  console.log(`Ready: ${report.ready ? "yes" : "no"}`);
  console.log(`Node: ${report.node.version} (minimum ${report.node.minimum})`);
  console.log(`Codex: ${report.codex.version} (minimum ${report.codex.minimum})`);
  console.log(`Login: ${report.login}`);
  console.log(`Image attachment: ${report.imageAttachment ? "yes" : "no"}`);
  console.log(`imagegen skill: ${report.imagegenSkill ?? "not found"}`);
  console.log(`Visual protocol: ${report.protocol ?? "not found"}`);
  console.log("Billing note: use `codex login` with your ChatGPT account if you intend to consume Codex subscription usage rather than API billing.");
  if (!report.ready) process.exitCode = 1;
}

function usage() {
  return [
    "Usage: node scripts/codex-visual.mjs <command> [args]",
    "",
    "Commands:",
    "  run [flags] <brief>  Delegate a visual audit, design, or comparison",
    "  status               Check Node, Codex, login, image input, and imagegen"
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usage());
    return;
  }
  if (command === "run") {
    await handleRun(rest);
    return;
  }
  if (command === "status") {
    handleStatus();
    return;
  }
  throw new Error(`Unknown command "${command}".\n${usage()}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

export {
  buildInstruction,
  compareSemver,
  createOutputDirectory,
  ensureReport,
  extractPrintedPaths,
  findImageArtifacts,
  inferExpectedMode,
  parseSemver,
  parseStudioArguments,
  renderResultMarkers,
  resolveReturnedMode,
  resolveCodex,
  splitFirstToken,
  timestampForFile
};
