#!/usr/bin/env node
// 小红书选题雷达 CLI。用法见 `npm run xhs -- help`
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, loadProfile, loadEnv } from "./config.mjs";
import { normalizeNote, normalizeProfile } from "./normalize.mjs";
import { scoreAccountNotes, median, interactions } from "./score.mjs";
import { runActor } from "./apify.mjs";
import { DIRS, indexBy, saveRaw, prevMetrics, upsertNote, upsertAccount, readFile } from "./vault.mjs";
import { addCard, syncStatus } from "./kanban.mjs";

const HELP = `
小红书选题雷达

  npm run xhs -- doctor                      检查配置、token、对标账号
  npm run xhs -- sync [--account 小红书号]    抓对标账号的主页+近期笔记 → 打分 → 写入 vault
  npm run xhs -- search 关键词 [关键词...]     关键词搜索热门笔记 → 打分 → 写入 vault
  npm run xhs -- import 文件.json [--account 小红书号] [--followers N] [--source 标签]
                                             导入任意来源的笔记 JSON（Apify 控制台导出、agent-reach 结果等）
  npm run xhs -- comments 笔记链接 [--limit 50] 抓评论（给 AI 做评论区挖掘），输出 JSON
  npm run xhs -- top [--days 7] [--min 50] [--limit 15] [--all]
                                             列出高分且未拆解的笔记（JSON，给 AI 用）
  npm run xhs -- kanban-add 列名 "[[选题名]]"  往选题看板加卡片
  npm run xhs -- kanban-sync                 看板列 → 选题笔记的「状态」字段
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    account: { type: "string" },
    followers: { type: "string" },
    source: { type: "string" },
    days: { type: "string" },
    min: { type: "string" },
    limit: { type: "string" },
    all: { type: "boolean" },
  },
});
const [cmd, ...args] = positionals;

loadEnv();
const cfg = loadConfig();
const V = cfg.vault;
const token = process.env[cfg.apify.tokenEnv];
const log = (...a) => console.error(...a);

function ingest(rawNotes, { bm, profile, source, folder }) {
  const notes = rawNotes.map(normalizeNote).filter(Boolean);
  const noteIndex = indexBy(path.join(V, DIRS.notes), "note_id");
  const prevById = prevMetrics(noteIndex);
  const followers = profile?.followers || undefined;
  // 有对标账号时按账号算基线；关键词搜索结果按作者分组
  const groups = bm ? { [bm.redId]: notes } : Object.groupBy(notes, (n) => n.userId || n.nickname || "?");
  const results = [];
  for (const group of Object.values(groups)) {
    results.push(...scoreAccountNotes(group, { followers, prevById }, cfg.scoring));
  }
  const counts = { created: 0, updated: 0 };
  for (const r of results) {
    const { status } = upsertNote(V, r, { source, folder, authorRedId: bm?.redId, followers, index: noteIndex });
    counts[status]++;
  }
  if (bm) {
    const accIndex = indexBy(path.join(V, DIRS.accounts), "小红书号");
    upsertAccount(V, bm, profile, {
      baseline: median(notes.map(interactions)),
      viralCount: results.filter((r) => r.metrics.tags.includes("爆款")).length,
    }, accIndex);
  }
  const top = results.sort((a, b) => b.metrics.score - a.metrics.score).slice(0, 3);
  log(`  ${notes.length} 篇（新 ${counts.created} / 更新 ${counts.updated}）` +
    (top.length ? `，最高：${top.map((t) => `${t.metrics.score}分「${t.note.title.slice(0, 16)}」`).join(" ")}` : ""));
  return results;
}

async function cmdSync() {
  const profile = loadProfile(V);
  const list = profile.benchmarks.filter((b) => !values.account || b.redId === values.account);
  const n = cfg.sync.notesPerAccount;
  let failed = 0;
  for (const bm of list) {
    log(`▶ ${bm.nickname || bm.redId}`);
    if (!bm.userId) {
      log(`  ⚠ 缺 user_id：在 账号定位.md 里补上该账号的「主页链接」（xiaohongshu.com/user/profile/...）`);
      failed++;
      continue;
    }
    try {
      const prof = (await runActor(cfg.apify.userProfile, { userId: bm.userId }, { token })).map(normalizeProfile).find(Boolean);
      const raw = await runActor(cfg.apify.userNotes, { userId: bm.userId, limit: n }, { token });
      saveRaw(V, "notes", bm.redId, raw);
      ingest(raw, { bm: { ...bm, nickname: prof?.nickname || bm.nickname }, profile: prof, source: "对标", folder: safeFolder(prof?.nickname || bm.nickname || bm.redId) });
    } catch (e) {
      failed++;
      log(`  ✗ ${e.message}`);
    }
  }
  log(`完成：${list.length - failed}/${list.length} 个账号`);
  if (failed && failed === list.length) process.exitCode = 1;
}

async function cmdSearch() {
  if (!args.length) throw new Error("用法：search 关键词 [关键词...]");
  for (const kw of args) {
    log(`▶ 搜索「${kw}」`);
    try {
      const raw = await runActor(cfg.apify.search, { keyword: kw, limit: cfg.sync.searchLimit }, { token });
      saveRaw(V, "search", kw, raw);
      ingest(raw, { source: `关键词:${kw}`, folder: `_关键词/${safeFolder(kw)}` });
    } catch (e) {
      process.exitCode = 1;
      log(`  ✗ ${e.message}`);
    }
  }
}

function cmdImport() {
  const file = args[0];
  if (!file) throw new Error("用法：import 文件.json [--account 小红书号]");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const raw = Array.isArray(data) ? data : data.items ?? data.notes ?? data.data ?? [];
  const profile = loadProfile(V);
  const bm = values.account ? profile.benchmarks.find((b) => b.redId === values.account) ?? { redId: values.account } : null;
  const prof = values.followers ? { followers: Number(values.followers) } : null;
  log(`▶ 导入 ${file}`);
  ingest(raw, {
    bm,
    profile: prof,
    source: values.source ?? (bm ? "对标" : "导入"),
    folder: bm ? safeFolder(bm.nickname || bm.redId) : `_导入/${safeFolder(values.source ?? "未分类")}`,
  });
}

async function cmdComments() {
  const url = args[0];
  if (!url) throw new Error("用法：comments 笔记链接");
  const raw = await runActor(cfg.apify.comments, { noteUrl: url, limit: Number(values.limit ?? 50) }, { token });
  const out = raw
    .map((c) => ({
      text: c.content ?? c.text ?? c.comment ?? "",
      likes: Number(c.like_count ?? c.likeCount ?? c.likes ?? 0) || 0,
      replies: Number(c.sub_comment_count ?? c.subCommentCount ?? c.reply_count ?? 0) || 0,
    }))
    .filter((c) => c.text)
    .sort((a, b) => b.likes - a.likes);
  console.log(JSON.stringify(out, null, 2));
}

function cmdTop() {
  const days = Number(values.days ?? 7);
  const min = Number(values.min ?? 50);
  const limit = Number(values.limit ?? 15);
  const since = Date.now() - days * 864e5;
  const rows = [];
  for (const [, file] of indexBy(path.join(V, DIRS.notes), "note_id")) {
    const d = readFile(file).data;
    if (!values.all && d.拆解) continue;
    if ((d.选题分 ?? 0) < min) continue;
    if (new Date(d.最近同步 ?? 0).getTime() < since) continue;
    rows.push({
      file: path.relative(V, file),
      title: d.标题, author: d.作者, score: d.选题分, outlier: d.超常倍数, interactions: d.互动,
      likes: d.赞, collects: d.藏, comments: d.评, tags: d.标签, url: d.链接, published: d.发布, source: d.来源,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  console.log(JSON.stringify(rows.slice(0, limit), null, 2));
}

function cmdDoctor() {
  const p = loadProfile(V);
  log(`vault: ${V}`);
  log(`APIFY_TOKEN: ${token ? "✓ 已设置" : "✗ 未设置（.env 或环境变量）"}`);
  log(`actor: ${cfg.apify.userNotes.actor}`);
  log(`关键词: ${p.keywords.join("、") || "（未设置）"}`);
  log(`对标账号 ${p.benchmarks.length} 个：`);
  for (const b of p.benchmarks) log(`  ${b.userId ? "✓" : "✗ 缺主页链接"}  ${b.redId} ${b.nickname ?? ""}`);
}

const safeFolder = (s) => String(s).replace(/[\\/:*?"<>|#^[\]]/g, " ").trim().slice(0, 30) || "未命名";
const board = path.join(V, "选题看板.md");

const commands = {
  doctor: cmdDoctor,
  sync: cmdSync,
  search: cmdSearch,
  import: cmdImport,
  comments: cmdComments,
  top: cmdTop,
  "kanban-add": () => log(addCard(board, args[0], args.slice(1).join(" ")) ? "✓ 已加入" : "已存在，跳过"),
  "kanban-sync": () => log(syncStatus(board, V).join("\n") || "无变化"),
  help: () => log(HELP),
};

try {
  await (commands[cmd] ?? commands.help)();
} catch (e) {
  log(`✗ ${e.message}`);
  process.exitCode = 1;
}
