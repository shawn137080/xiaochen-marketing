// 读写 Obsidian Kanban 插件的看板文件（就是普通 Markdown：## 列名 + - [ ] 卡片）
import fs from "node:fs";
import path from "node:path";
import { readFile, mergeFile } from "./frontmatter.mjs";

export const LANES = ["待选", "已选", "写稿", "待录", "待剪", "已发布", "复盘"];

export function parseBoard(text) {
  const settingsAt = text.indexOf("%% kanban:settings");
  const main = settingsAt >= 0 ? text.slice(0, settingsAt) : text;
  const tail = settingsAt >= 0 ? text.slice(settingsAt) : "";
  const parts = main.split(/^## /m);
  const head = parts.shift();
  const lanes = parts.map((p) => {
    const [title, ...rest] = p.split("\n");
    const cards = [];
    for (const line of rest) {
      if (/^- \[[ xX]\] /.test(line)) cards.push(line);
      else if (cards.length && /^\s+\S/.test(line)) cards[cards.length - 1] += "\n" + line;
    }
    return { title: title.trim(), cards };
  });
  return { head, lanes, tail };
}

export function renderBoard({ head, lanes, tail }) {
  const body = lanes.map((l) => `## ${l.title}\n\n${l.cards.join("\n")}${l.cards.length ? "\n" : ""}`).join("\n");
  return `${head}${body}\n${tail}`;
}

/** 添加卡片到某列（同一 [[链接]] 已在任何列中则跳过） */
export function addCard(boardFile, lane, text) {
  const board = parseBoard(fs.readFileSync(boardFile, "utf8"));
  const link = text.match(/\[\[[^\]]+\]\]/)?.[0];
  const exists = board.lanes.some((l) => l.cards.some((c) => (link ? c.includes(link) : c.includes(text))));
  if (exists) return false;
  let target = board.lanes.find((l) => l.title === lane);
  if (!target) board.lanes.push((target = { title: lane, cards: [] }));
  target.cards.push(`- [ ] ${text}`);
  fs.writeFileSync(boardFile, renderBoard(board));
  return true;
}

/** 把看板上的列名回写到选题笔记的「状态」字段，Dataview 才能按状态查询 */
export function syncStatus(boardFile, vault) {
  const board = parseBoard(fs.readFileSync(boardFile, "utf8"));
  const changed = [];
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      for (const [, name] of card.matchAll(/\[\[([^\]|#]+)/g)) {
        const file = findNote(vault, name);
        if (!file) continue;
        const fm = readFile(file);
        if (fm?.data?.type === "选题" && fm.data.状态 !== lane.title) {
          mergeFile(file, { 状态: lane.title, 状态更新: new Date().toISOString().slice(0, 10) });
          changed.push(`${name}: ${fm.data.状态 ?? "-"} → ${lane.title}`);
        }
      }
    }
  }
  return changed;
}

function findNote(vault, name) {
  const direct = path.join(vault, name.endsWith(".md") ? name : `${name}.md`);
  if (fs.existsSync(direct)) return direct;
  const base = path.basename(name) + (name.endsWith(".md") ? "" : ".md");
  const stack = [vault];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === base) return p;
    }
  }
  return null;
}
