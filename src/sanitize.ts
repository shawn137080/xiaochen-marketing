/**
 * 小红书敏感词脱敏工具
 *
 * 在发布前自动替换可能触发平台限流的词汇。
 * 替换策略：保持语义，降低被算法降权的概率。
 */

interface Replacement {
  pattern: RegExp;
  replacement: string;
  reason: string;
}

const REPLACEMENTS: Replacement[] = [
  // AI / 人工智能 — 小红书对 AI 营销内容有降权倾向
  // 注意：复合词必须排在通用 \bAI\b 之前，否则 AI 会先被替换成兜兜
  { pattern: /兜兜AI/g,            replacement: "兜兜",      reason: "弱化AI标签" },
  { pattern: /AI接电话/g,          replacement: "兜兜帮你接", reason: "AI相关" },
  { pattern: /AI助手/g,            replacement: "兜兜",      reason: "AI相关" },
  { pattern: /AI帮/g,              replacement: "兜兜帮",    reason: "AI相关" },
  { pattern: /\bAI\b/g,           replacement: "兜兜",      reason: "AI品牌词" },
  { pattern: /人工智能/g,          replacement: "智能助理",  reason: "AI相关" },

  // 绝对化承诺词 — 违反广告法/平台规则
  { pattern: /100%保证/g,          replacement: "绝大多数情况下", reason: "绝对化承诺" },
  { pattern: /保证.*?增收/g,       replacement: "帮助增收",        reason: "绝对化承诺" },
  { pattern: /绝对/g,              replacement: "通常",            reason: "绝对化用词" },
  { pattern: /最\s*牛/g,           replacement: "超好用",          reason: "极限词" },
  { pattern: /第一名/g,            replacement: "口碑很好",        reason: "极限词" },

  // 金融/收益相关敏感词
  { pattern: /月入\s*\d+/g,        replacement: (m) => m.replace("月入", "月多赚"), reason: "收益承诺" },
  { pattern: /躺赚/g,              replacement: "省心赚钱",        reason: "被动收益暗示" },
  { pattern: /暴富/g,              replacement: "增收",            reason: "极端收益词" },

  // 竞品/贬低同行
  { pattern: /比.*?便宜\d+倍/g,   replacement: "性价比高",        reason: "竞品对比" },
];

/** 对单个字符串做脱敏，返回替换后的文本和改动日志 */
export function sanitize(text: string): { result: string; changes: string[] } {
  let result = text;
  const changes: string[] = [];

  for (const r of REPLACEMENTS) {
    const before = result;
    result = result.replace(r.pattern, r.replacement as string);
    if (result !== before) {
      changes.push(`[${r.reason}] ${r.pattern} → "${r.replacement}"`);
    }
  }

  return { result, changes };
}

/** 对笔记的 title、content、tags 同时脱敏 */
export function sanitizeNote(note: {
  title: string;
  content: string;
  tags: string;
}): {
  title: string;
  content: string;
  tags: string;
  changes: string[];
} {
  const allChanges: string[] = [];

  const { result: title, changes: tc } = sanitize(note.title);
  allChanges.push(...tc.map(c => `[标题] ${c}`));

  const { result: content, changes: cc } = sanitize(note.content);
  allChanges.push(...cc.map(c => `[正文] ${c}`));

  // tags 是 JSON 字符串，反序列化后逐项处理
  let tags = note.tags;
  try {
    const tagArr: string[] = JSON.parse(note.tags);
    const sanitizedTags = tagArr.map(t => {
      const { result, changes } = sanitize(t);
      allChanges.push(...changes.map(c => `[标签] ${c}`));
      return result;
    });
    tags = JSON.stringify(sanitizedTags);
  } catch {
    // 非 JSON，直接处理字符串
    const { result, changes } = sanitize(note.tags);
    tags = result;
    allChanges.push(...changes.map(c => `[标签] ${c}`));
  }

  return { title, content, tags, changes: allChanges };
}
