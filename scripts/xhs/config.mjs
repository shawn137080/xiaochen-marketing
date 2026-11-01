import fs from "node:fs";
import path from "node:path";
import { readFile } from "./frontmatter.mjs";
import { DEFAULT_SCORING } from "./score.mjs";
import { userIdFromUrl } from "./normalize.mjs";

export const ROOT = path.resolve(import.meta.dirname, "../..");

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "xhs.config.json"), "utf8"));
  const vault = process.env.XHS_VAULT || path.join(ROOT, cfg.vaultDir ?? "vault");
  const s = cfg.scoring ?? {};
  return {
    ...cfg,
    vault,
    scoring: { ...DEFAULT_SCORING, ...s, weights: { ...DEFAULT_SCORING.weights, ...(s.weights ?? {}) } },
  };
}

/** 账号定位 = 唯一的人设/对标/关键词来源，在 Obsidian 里编辑 */
export function loadProfile(vault) {
  const file = path.join(vault, "00-定位/账号定位.md");
  const fm = readFile(file);
  if (!fm) throw new Error(`找不到 ${file}`);
  const benchmarks = (fm.data.对标账号 ?? []).map((b) => {
    const o = typeof b === "object" && b ? b : { 小红书号: String(b) };
    const url = o.主页链接 ?? "";
    return {
      redId: String(o.小红书号 ?? "").trim(),
      userId: String(o.user_id ?? "").trim() || userIdFromUrl(url),
      url,
      nickname: o.昵称 ?? "",
    };
  });
  return { ...fm.data, benchmarks, keywords: fm.data.关键词 ?? [] };
}

/** 读取 .env（不引依赖） */
export function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
