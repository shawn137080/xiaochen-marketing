// 读写 Obsidian Markdown 的 YAML frontmatter
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** @returns {{data: Record<string, any>, body: string}} */
export function parse(text) {
  const m = text.match(FM_RE);
  if (!m) return { data: {}, body: text };
  return { data: YAML.parse(m[1]) ?? {}, body: text.slice(m[0].length) };
}

export function stringify(data, body = "") {
  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body.startsWith("\n") ? body : "\n" + body}`;
}

export function readFile(file) {
  if (!fs.existsSync(file)) return null;
  return parse(fs.readFileSync(file, "utf8"));
}

export function writeFile(file, data, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringify(data, body));
}

/** 只合并 frontmatter，保留正文（用户/AI 写的拆解不会被覆盖） */
export function mergeFile(file, patch, defaultBody = "") {
  const existing = readFile(file);
  if (!existing) {
    writeFile(file, patch, defaultBody);
    return "created";
  }
  writeFile(file, { ...existing.data, ...patch }, existing.body);
  return "updated";
}
