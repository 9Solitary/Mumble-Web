#!/usr/bin/env node
// 发布前敏感信息门禁：只扫描 git 跟踪的文件，只输出文件/行号/规则，不打印命中值。
// 用法：
//   node scripts/scan-secrets.mjs            # 当前工作区已跟踪文件
//   node scripts/scan-secrets.mjs --history  # 额外扫描历史提交内容与历史路径
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const findings = [];

function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

const RULES = [
  {
    id: "private-key",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    id: "tls-pin",
    re: /\bpin:[0-9a-fA-F]{40,}\b/g,
  },
  {
    id: "bearer-token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/g,
  },
  {
    id: "invite-secret",
    // 只允许空值或明显的占位符；真实密钥会被拦下。
    re: /^[ \t]*INVITE_SECRET[ \t]*=[ \t]*(\S+)/gm,
    allow: (match) => /^(?:$|<|change|example|your[-_])/i.test(match[1]),
  },
  {
    id: "public-ipv4",
    // 排除回环、私网、全零、文档示例与测试固定地址；只提示公网 IPv4。
    re: /(?<![\d.])(?!10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0|1\.2\.3\.4|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
  },
];

function scanContent(file, content) {
  if (content.includes("\0")) return;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match;
    while ((match = rule.re.exec(content))) {
      if (rule.allow?.(match)) continue;
      findings.push({ scope: "worktree", file, line: lineOf(content, match.index), rule: rule.id });
      break; // 同一文件同一规则只报一次，避免日志刷屏
    }
  }
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

for (const file of files) {
  try {
    scanContent(file, readFileSync(file, "utf8"));
  } catch {
    // 二进制/超大文件/读取失败：跳过，不阻断扫描
  }
}

if (args.has("--history")) {
  const suspiciousPath =
    /(^|\/)\.env(?:\.|$)|\.log$|^dist\/|^docs\/ui-redesign\//;
  const historyNames = execFileSync(
    "git",
    ["log", "--all", "--name-only", "--pretty=format:"],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .filter(Boolean);
  for (const name of new Set(historyNames)) {
    if (name !== ".env.example" && suspiciousPath.test(name)) {
      findings.push({ scope: "history-path", file: name, line: 0, rule: "suspicious-path" });
    }
  }

  const commits = execFileSync("git", ["rev-list", "--all"], { encoding: "utf8" })
    .split(/\s+/)
    .filter(Boolean);
  const historyRules = [
    "-----BEGIN .*PRIVATE KEY-----",
    "pin:[0-9a-fA-F]{40,}",
    "Bearer [A-Za-z0-9._~+/=-]{24,}",
    "INVITE_SECRET=[^[:space:]]",
  ];
  for (const commit of commits) {
    for (const pattern of historyRules) {
      let out = "";
      try {
        out = execFileSync(
          "git",
          ["grep", "-l", "-I", "-E", pattern, commit, "--", "."],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch {
        continue;
      }
      for (const file of out.split(/\r?\n/).filter(Boolean)) {
        findings.push({ scope: `commit ${commit.slice(0, 8)}`, file, line: 0, rule: "history-content" });
      }
    }
  }
}

if (findings.length === 0) {
  console.log("[secrets] 未发现敏感信息");
  process.exit(0);
}

for (const finding of findings) {
  const location = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
  console.error(`[secrets] ${finding.scope} ${location} [${finding.rule}]`);
}
console.error(`[secrets] 共 ${findings.length} 项，请人工确认后再发布。`);
process.exit(1);
