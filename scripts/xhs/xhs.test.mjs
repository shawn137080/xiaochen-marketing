import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseCount, normalizeNote, normalizeProfile, userIdFromUrl, parseTime } from "./normalize.mjs";
import { scoreNote, scoreAccountNotes, median } from "./score.mjs";
import { parseBoard, renderBoard, addCard, syncStatus } from "./kanban.mjs";
import { parse, stringify } from "./frontmatter.mjs";
import { buildInput } from "./apify.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("parseCount 处理中文单位", () => {
  assert.equal(parseCount("1.2万"), 12000);
  assert.equal(parseCount("3.5w"), 35000);
  assert.equal(parseCount("10+"), 10);
  assert.equal(parseCount("3,456"), 3456);
  assert.equal(parseCount(null), 0);
  assert.equal(parseCount(88), 88);
});

test("parseTime 秒/毫秒/ISO", () => {
  assert.equal(parseTime(1700000000), "2023-11-14T22:13:20.000Z");
  assert.equal(parseTime(1700000000000), "2023-11-14T22:13:20.000Z");
  assert.equal(parseTime("bad"), null);
});

test("normalizeNote 兼容嵌套 note_card / interact_info 字段", () => {
  const n = normalizeNote({
    id: "abc",
    xsec_token: "tok",
    note_card: {
      display_title: "标题",
      type: "video",
      user: { user_id: "u1", nickname: "小明" },
      interact_info: { liked_count: "1.1万", collected_count: "2000", comment_count: "300" },
      tag_list: [{ name: "AI工具" }],
    },
  });
  assert.equal(n.title, "标题");
  assert.equal(n.type, "video");
  assert.equal(n.likes, 11000);
  assert.equal(n.collects, 2000);
  assert.equal(n.comments, 300);
  assert.equal(n.nickname, "小明");
  assert.deepEqual(n.tags, ["AI工具"]);
  assert.match(n.url, /explore\/abc\?xsec_token=tok/);
  assert.equal(normalizeNote({ foo: 1 }), null);
});

test("normalizeProfile 读 interactions 里的粉丝数", () => {
  const p = normalizeProfile({ basic_info: { nickname: "A", red_id: "123" }, interactions: [{ type: "fans", count: "2.3万" }] });
  assert.equal(p.followers, 23000);
  assert.equal(p.redId, "123");
});

test("userIdFromUrl", () => {
  assert.equal(userIdFromUrl("https://www.xiaohongshu.com/user/profile/5f1a2b3c4d5e6f7a8b9c0d1e?xsec=1"), "5f1a2b3c4d5e6f7a8b9c0d1e");
  assert.equal(userIdFromUrl(""), "");
});

const mk = (likes, collects = 0, comments = 0, extra = {}) => ({ id: String(Math.random()), title: "t", desc: "", type: "normal", likes, collects, comments, shares: 0, publishedAt: null, userId: "u", nickname: "n", url: "", cover: "", tags: [], ...extra });

test("超常笔记得分高于账号常规笔记，并打上爆款标签", () => {
  const notes = [mk(100, 50, 10), mk(120, 40, 8), mk(90, 60, 5), mk(1500, 1800, 200)];
  const scored = scoreAccountNotes(notes, { followers: 20000 });
  const [a, b, c, viral] = scored.map((s) => s.metrics);
  assert.ok(viral.score > Math.max(a.score, b.score, c.score) + 20, `viral ${viral.score}`);
  assert.ok(viral.tags.includes("爆款"));
  assert.ok(viral.tags.includes("干货收藏型"));
  assert.ok(!a.tags.includes("爆款"));
});

test("低粉爆文标签", () => {
  const m = scoreNote(mk(2000, 800, 100), { followers: 800, baseline: 300 });
  assert.ok(m.tags.includes("低粉爆文"));
  assert.ok(m.fanRatio > 3);
});

test("新鲜度：老笔记打折但不归零", () => {
  const now = new Date("2026-11-01");
  const fresh = scoreNote(mk(1000, 500, 50, { publishedAt: "2026-10-31T00:00:00Z" }), { baseline: 200, followers: 10000, now });
  const old = scoreNote(mk(1000, 500, 50, { publishedAt: "2025-01-01T00:00:00Z" }), { baseline: 200, followers: 10000, now });
  assert.ok(fresh.score > old.score);
  assert.ok(old.score >= fresh.score * 0.55);
});

test("日增互动 + 正在涨", () => {
  const now = new Date("2026-11-02T00:00:00Z");
  const m = scoreNote(mk(1000, 500, 100), { baseline: 200, now, prev: { interactions: 1000, syncedAt: "2026-11-01T00:00:00Z" } });
  assert.equal(m.growthPerDay, 600);
  assert.ok(m.tags.includes("正在涨"));
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test("frontmatter 往返", () => {
  const text = stringify({ 标题: "你好", 标签: ["a", "b"], 分: 3 }, "\n正文\n");
  const { data, body } = parse(text);
  assert.deepEqual(data, { 标题: "你好", 标签: ["a", "b"], 分: 3 });
  assert.equal(body.trim(), "正文");
});

test("buildInput 替换模板并保留数字类型", () => {
  const input = buildInput({ input: { user_id: "{{userId}}", max: "{{limit}}", q: "kw:{{keyword}}" } }, { userId: "u1", limit: 30, keyword: "AI" });
  assert.deepEqual(input, { user_id: "u1", max: 30, q: "kw:AI" });
});

test("看板：解析/渲染往返、加卡去重、状态回写", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-"));
  const boardFile = path.join(tmp, "选题看板.md");
  fs.copyFileSync(path.join(ROOT, "vault/选题看板.md"), boardFile);
  const original = fs.readFileSync(boardFile, "utf8");
  assert.equal(parseBoard(original).lanes.length, 7);
  assert.equal(renderBoard(parseBoard(original)).includes("%% kanban:settings"), true);

  fs.mkdirSync(path.join(tmp, "40-选题库"));
  fs.writeFileSync(path.join(tmp, "40-选题库/测试选题.md"), stringify({ type: "选题", 状态: "待选" }, "x"));
  assert.equal(addCard(boardFile, "已选", "[[测试选题]]"), true);
  assert.equal(addCard(boardFile, "待选", "[[测试选题]]"), false);
  assert.deepEqual(syncStatus(boardFile, tmp), ["测试选题: 待选 → 已选"]);
  assert.equal(parse(fs.readFileSync(path.join(tmp, "40-选题库/测试选题.md"), "utf8")).data.状态, "已选");
});

test("CLI import 端到端：写入笔记+账号，二次导入保留正文", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-vault-"));
  fs.cpSync(path.join(ROOT, "vault/00-定位"), path.join(tmp, "00-定位"), { recursive: true });
  const fixture = path.join(tmp, "notes.json");
  // 测试夹具（虚构数据，仅用于测试）
  fs.writeFileSync(fixture, JSON.stringify([
    { note_id: "n1", title: "普通笔记A", liked_count: 100, collected_count: 50, comment_count: 10, time: 1761900000 },
    { note_id: "n2", title: "普通笔记B", liked_count: 120, collected_count: 40, comment_count: 8, time: 1761900000 },
    { note_id: "n3", title: "爆款笔记", liked_count: "1.5万", collected_count: "1.8万", comment_count: 900, time: 1761900000 },
  ]));
  const run = (...a) => execFileSync("node", [path.join(ROOT, "scripts/xhs/cli.mjs"), ...a], { env: { ...process.env, XHS_VAULT: tmp, APIFY_TOKEN: "" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("import", fixture, "--account", "AIZ80", "--followers", "30000");

  const noteDir = path.join(tmp, "20-对标笔记/AIZ80");
  const files = fs.readdirSync(noteDir);
  assert.equal(files.length, 3);
  const viralFile = path.join(noteDir, files.find((f) => f.includes("爆款")));
  const viral = parse(fs.readFileSync(viralFile, "utf8"));
  assert.ok(viral.data.标签.includes("爆款"));
  assert.equal(viral.data.拆解, false);
  assert.equal(viral.data.作者小红书号, "AIZ80");
  assert.ok(fs.existsSync(path.join(tmp, "10-对标账号/AIZ80.md")));

  // 模拟 AI 写了拆解，再导入一次：正文必须保留
  fs.writeFileSync(viralFile, fs.readFileSync(viralFile, "utf8").replace("## 拆解", "## 拆解\n我的拆解内容"));
  run("import", fixture, "--account", "AIZ80", "--followers", "30000");
  assert.equal(fs.readdirSync(noteDir).length, 3);
  assert.match(fs.readFileSync(viralFile, "utf8"), /我的拆解内容/);

  const top = JSON.parse(run("top", "--min", "0"));
  assert.equal(top[0].title, "爆款笔记");
});
