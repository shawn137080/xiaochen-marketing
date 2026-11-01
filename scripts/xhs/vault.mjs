// 把数据写进 Obsidian vault。原则：只更新 frontmatter 里的数据字段，正文（拆解、想法）永不覆盖。
import fs from "node:fs";
import path from "node:path";
import { readFile, mergeFile, writeFile } from "./frontmatter.mjs";

export const DIRS = {
  profile: "00-定位",
  accounts: "10-对标账号",
  notes: "20-对标笔记",
  hot: "30-热点",
  topics: "40-选题库",
  drafts: "50-稿件",
  raw: "_data/raw",
};

export function safeName(s, max = 40) {
  const clean = String(s ?? "")
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...clean].slice(0, max).join("") || "无标题";
}

const today = (d = new Date()) => d.toISOString().slice(0, 10);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

/** 按 frontmatter 某个字段建立索引：值 → 文件路径 */
export function indexBy(dir, key) {
  const map = new Map();
  for (const f of walk(dir)) {
    const fm = readFile(f);
    const v = fm?.data?.[key];
    if (v != null && v !== "") map.set(String(v), f);
  }
  return map;
}

export function saveRaw(vault, kind, label, items) {
  const dir = path.join(vault, DIRS.raw, today());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}-${safeName(label, 30)}.json`);
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
  return file;
}

/** 读取已有笔记的上次互动，用来算日增 */
export function prevMetrics(noteIndex) {
  const prev = {};
  for (const [id, file] of noteIndex) {
    const d = readFile(file)?.data;
    if (d?.互动 != null && d?.最近同步) prev[id] = { interactions: Number(d.互动), syncedAt: String(d.最近同步) };
  }
  return prev;
}

const NOTE_BODY = (n) => `
> [!quote]- 原文
${(n.desc || "（无正文）").split("\n").map((l) => "> " + l).join("\n")}

## 拆解
<!-- 在 chat 里说「拆解这篇」或运行 /xhs-breakdown，AI 会写在这里 -->

## 我的想法

`;

/**
 * @param {{note: import('./normalize.mjs').Note, metrics: ReturnType<import('./score.mjs').scoreNote>}} item
 * @param {{source: string, folder: string, authorRedId?: string, followers?: number, index: Map}} ctx
 */
export function upsertNote(vault, { note: n, metrics: m }, ctx) {
  const now = new Date().toISOString();
  const patch = {
    type: "对标笔记",
    note_id: n.id,
    标题: n.title || n.desc.slice(0, 30),
    作者: n.nickname,
    作者小红书号: ctx.authorRedId ?? "",
    作者粉丝: ctx.followers ?? null,
    链接: n.url,
    封面: n.cover,
    形式: n.type === "video" ? "视频" : "图文",
    发布: n.publishedAt ? n.publishedAt.slice(0, 10) : null,
    赞: n.likes,
    藏: n.collects,
    评: n.comments,
    互动: m.interactions,
    选题分: m.score,
    超常倍数: m.outlier,
    赞粉比: m.fanRatio,
    藏赞比: m.collectRatio,
    评赞比: m.commentRatio,
    日增互动: m.growthPerDay,
    标签: m.tags,
    话题: n.tags,
    来源: ctx.source,
    最近同步: now,
  };
  let file = ctx.index.get(n.id);
  if (!file) {
    file = path.join(vault, DIRS.notes, ctx.folder, `${patch.发布 ?? today()} ${safeName(patch.标题)}.md`);
    patch.首次发现 = today();
    patch.拆解 = false;
    ctx.index.set(n.id, file);
  }
  return { file, status: mergeFile(file, patch, NOTE_BODY(n)) };
}

const ACCOUNT_BODY = `
## 这个账号的笔记（按选题分）
\`\`\`dataview
TABLE WITHOUT ID file.link AS 笔记, 选题分, 超常倍数 AS 倍数, 互动, 标签, 发布
FROM "20-对标笔记"
WHERE 作者小红书号 = this.小红书号
SORT 选题分 DESC
LIMIT 30
\`\`\`

## 观察
<!-- 定位、更新频率、爆款规律，AI 或你自己写 -->
`;

export function upsertAccount(vault, bm, profile, stats, index) {
  const patch = {
    type: "对标账号",
    小红书号: bm.redId,
    user_id: profile?.userId || bm.userId || "",
    昵称: profile?.nickname || bm.nickname || bm.redId,
    简介: profile?.desc ?? "",
    粉丝: profile?.followers ?? null,
    赞藏总数: profile?.totalLikesCollects ?? null,
    互动中位数: stats.baseline,
    爆款数: stats.viralCount,
    最近同步: new Date().toISOString(),
  };
  let file = index.get(bm.redId);
  if (file) {
    const prev = readFile(file)?.data;
    if (prev?.粉丝 != null && patch.粉丝 != null) patch.粉丝日变化 = patch.粉丝 - prev.粉丝;
  } else {
    file = path.join(vault, DIRS.accounts, `${safeName(patch.昵称)}.md`);
    index.set(bm.redId, file);
  }
  mergeFile(file, patch, ACCOUNT_BODY);
  return file;
}

export { writeFile, readFile, today };
