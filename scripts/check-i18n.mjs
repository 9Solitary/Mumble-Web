// 中英文 key 对齐检查：CI / 提交前跑 `npm run i18n:check`。
// 只比较 key 结构，不检查翻译质量。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const locales = ["zh-CN", "en-US"];

function flatten(value, prefix = "") {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const keySets = locales.map((locale) => {
  const json = JSON.parse(
    readFileSync(join(root, "src", "i18n", "locales", `${locale}.json`), "utf8"),
  );
  return { locale, keys: flatten(json).sort() };
});

const base = keySets[0];
let failed = false;
for (const set of keySets.slice(1)) {
  const missing = base.keys.filter((key) => !set.keys.includes(key));
  const extra = set.keys.filter((key) => !base.keys.includes(key));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`[i18n] ${set.locale} 与 ${base.locale} 不一致`);
    if (missing.length) console.error(`  缺少: ${missing.join(", ")}`);
    if (extra.length) console.error(`  多余: ${extra.join(", ")}`);
  }
}

if (failed) process.exit(1);
console.log(`[i18n] ${locales.join(" / ")} key 一致（${base.keys.length} 个）`);
