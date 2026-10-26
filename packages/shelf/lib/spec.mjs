import { fail } from "./output.mjs";

// 命令表：帮助文本、`shelf help --json` 和参数校验共用这一份。
// flags 的值："bool" = 开关，"value" = 带一个值。所有命令都额外接受全局的 --json / --help。
export const COMMANDS = {
  browse: {
    usage: "shelf",
    summary: "交互浏览货架：数字进目录 · p 1,3-5 拉取所选 · a 全部 · .. 上级 · q 退出（给人用，agent 用 ls）",
    flags: {},
  },
  ls: {
    usage: "shelf ls [货架路径]",
    summary: "列出货架某一层：类型、大小、本项目是否已装、装在哪（非交互）",
    flags: {},
    examples: ["shelf ls", "shelf ls skills/common --json"],
  },
  status: {
    usage: "shelf status",
    summary: "只读对账（等同 sync --dry-run）：每件物品是一致、待更新还是待决，模板新增了什么，附下一步命令",
    flags: {},
    examples: ["shelf status"],
  },
  sync: {
    usage: "shelf sync [--merge] [--push] [--dry-run]",
    summary: "同步 ai 工作流：装上模板新增的货，货架新版且本地没动的自动更新；--merge 三方合并双改的，--push 把本地领先与合并干净的推上货架，冲突留给人",
    flags: { "--dry-run": "bool", "--merge": "bool", "--push": "bool" },
    examples: ["shelf sync", "shelf sync --merge --push", "shelf sync --dry-run"],
  },
  diff: {
    usage: "shelf diff <货架路径或本地路径> [--stat]",
    summary: "三方对比（只读）：① 货架在上次拉取之后改了什么 ② 推上去会改成什么；--stat 只出统计",
    flags: { "--stat": "bool" },
    examples: ["shelf diff ai/jaSkills/intj", "shelf diff skills/common/intj --stat"],
  },
  merge: {
    usage: "shelf merge <货架路径或本地路径> [--take-mirror]",
    summary: "三方合并「双方都改过」的物品：以上次拉取的版本为基准合并货架 HEAD 与本地，结果写回本地（账本等 push 成功才更新）；--take-mirror 见 push",
    flags: { "--take-mirror": "bool" },
    examples: ["shelf merge ai/jaSkills/intj"],
  },
  pull: {
    usage: "shelf pull <货架路径或本地路径...> [--dest <目录>] [--force]",
    summary: "拉取：记过账的回到原位，新技能默认进技能正本，其余落当前目录；--force 用货架版本覆盖本地改动（含植入物重新植入）",
    flags: { "--dest": "value", "--force": "bool" },
    examples: ["shelf pull skills/common/intj", "shelf pull ai/jaSkills/intj --force", "shelf pull docs/JASKILL.md --force"],
  },
  push: {
    usage: "shelf push <本地路径> [--yes] [--force] [--force-secret] [--take-mirror]",
    summary: "更新货架上已有的物品：按账本 / 名字自动定位；不带 --yes 先列变更清单（退出 2）。根目录副本改过、正本没动时先列差异停下（退出 2），人看过、确认后加 --take-mirror 把副本的改动收进正本再推",
    flags: { "--yes": "bool", "--force": "bool", "--force-secret": "bool", "--take-mirror": "bool" },
    examples: ["shelf push ai/jaSkills/intj", "shelf push ai/jaSkills/intj --yes", "shelf push ai/jaAgents/CLAUDE.md --take-mirror"],
  },
  create: {
    usage: "shelf create <本地路径> [--to <货架目录>] [--yes] [--force-secret]",
    summary: "上架新物品：全架查重名（名字即 ID）；非交互必须 --to",
    flags: { "--to": "value", "--yes": "bool", "--force-secret": "bool" },
    examples: ["shelf create ai/jaSkills/my-skill --to skills/common --yes"],
  },
  forget: {
    usage: "shelf forget <货架路径或本地路径...>",
    summary: "从账本里删掉物品（本地文件不动）：处理「货架已下架」「本地已删」这类待决",
    flags: {},
    examples: ["shelf forget skills/old-skill"],
  },
  init: {
    usage: "shelf init [--agents claude,codex,kimi|all] [--ai-dir <名>] [--template <名>]",
    summary: "初始化 ai 工作流（幂等）：没有账本 = 按模板新接入；有账本 = 按账本还原补齐（换设备 / 新 worktree）。协议、技能、链接、gitignore、脚手架、本地技能登记一次到位",
    flags: { "--agents": "value", "--ai-dir": "value", "--template": "value" },
    examples: ["shelf init", "shelf init --agents claude,codex", "shelf init --agents all --ai-dir AI"],
  },
  template: {
    usage: "shelf template [ls | show [<名>]]",
    summary: "看货架上的模板：ls 列出有哪些，show 展开某个模板会装哪些货、落在哪（按本项目的 agent 与 ai 区）",
    flags: {},
    examples: ["shelf template", "shelf template show ai"],
  },
  agents: {
    usage: "shelf agents [add <名>]",
    summary: "查看 / 追加 agent 目标（claude / codex / kimi）",
    flags: {},
    examples: ["shelf agents", "shelf agents add codex"],
  },
  adopt: {
    usage: "shelf adopt",
    summary: "收编外来技能：实体目录迁入技能正本并重链，未记账技能登记进账本 local 段（不上货架）",
    flags: {},
  },
  home: {
    usage: "shelf home [--update]",
    summary: "货架在哪、什么模式；--update 立即拉最新",
    flags: { "--update": "bool" },
  },
  version: {
    usage: "shelf version（或 shelf --version / -v）",
    summary: "打印 CLI 版本",
    flags: {},
  },
  help: {
    usage: "shelf help [命令]",
    summary: "总览或某个命令的用法；help --json 输出机器可读的命令表",
    flags: {},
  },
};

export const ORDER = [
  "init", "sync", "status", "diff", "merge", "push", "pull", "create", "forget",
  "template", "ls", "browse", "agents", "adopt", "home", "version", "help",
];

export const EXIT_CODES = [
  { code: 0, meaning: "成功 / 无需变更 / 全部一致" },
  { code: 1, meaning: "参数错误、未知命令或参数、找不到物品或模板、重名、凭据拦截、正本与副本各改各的、植入物不推" },
  { code: 2, meaning: "要人或 agent 处理：变更清单已打印（加 --yes 重跑）；副本改过、正本没动（看过差异后加 --take-mirror 重跑）；init / sync / status 有待决；diff 有差异；pull 因本地改动没覆盖" },
  { code: 3, meaning: "冲突：货架在你上次拉取后被改过、多个同名无法自动选、merge / sync --merge 有冲突、冲突标记还没解决" },
  { code: 4, meaning: "提交或推送失败（货架已回滚到改动前）" },
];

// 解析某个命令的参数；未知参数直接报错（agent 编造的参数不会被悄悄忽略）
export function parseArgs(command, argv) {
  const spec = COMMANDS[command]?.flags ?? {};
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const kind = spec[name];
    if (!kind) {
      const known = Object.keys(spec);
      fail(1, `✗ ${command} 不认识参数 ${name}` + (known.length ? `（可用: ${known.join(" ")}）` : "（这个命令没有参数）")
        + `；用法: ${COMMANDS[command].usage}`);
    }
    if (kind === "value") {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) fail(1, `✗ ${name} 需要一个值；用法: ${COMMANDS[command].usage}`);
      flags[name] = v;
    } else {
      if (inline !== undefined) fail(1, `✗ ${name} 是开关，不接受值`);
      flags[name] = true;
    }
  }
  return { flags, positionals };
}

export function usageText() {
  const lines = ["shelf — 个人内容货架 CLI（别名 atk）", "", "命令:"];
  // 中文在终端里占两格，按列对齐会错位：用法一行、说明缩进放下一行
  for (const n of ORDER) {
    const c = COMMANDS[n];
    lines.push(`  ${c.usage}`, `      ${c.summary}`);
  }
  lines.push(
    "",
    "输出：终端里是给人看的文字；输出不是终端（agent / 脚本 / 管道）时默认一份 JSON。--json / --text 强制其一，也可设 SHELF_OUTPUT=json|text",
    "全局参数: --json · --text · --help（看某个命令的用法）",
    "",
    "退出码:",
  );
  for (const e of EXIT_CODES) lines.push(`  ${e.code}  ${e.meaning}`);
  lines.push(
    "",
    "货架定位：SHELF_HOME 环境变量 > ~/.shelfrc > 托管档口 ~/.shelf/home（自动创建）",
    "非交互（agent / 管道 / JSON 输出 / SHELF_NONINTERACTIVE=1）时绝不等键盘：要确认的退出 2，冲突退出 3",
  );
  return lines.join("\n");
}

export function commandHelp(name) {
  const c = COMMANDS[name];
  const lines = [`用法: ${c.usage}`, "", c.summary];
  const flags = Object.keys(c.flags);
  if (flags.length) lines.push("", "参数: " + flags.join(" ") + " （另有全局 --json / --text）");
  if (c.examples?.length) lines.push("", "例子:", ...c.examples.map((e) => "  " + e));
  return lines.join("\n");
}
