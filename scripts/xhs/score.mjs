// 选题价值打分：判断一篇笔记「作为选题」有多值得参考。
//
// 核心思路：不看绝对点赞，而看「相对该账号自身水平的超常程度」(outlier)
// —— 一个账号平时 200 互动、某篇突然 2000，说明是选题本身起作用，不是账号权重。
// 再叠加低粉爆文（赞粉比）、干货收藏型（藏赞比）、讨论度（评赞比）。

export const DEFAULT_SCORING = {
  weights: { outlier: 0.35, fanRatio: 0.2, volume: 0.2, collect: 0.15, comment: 0.1 },
  outlierCap: 10, // 达到账号中位数 10 倍记满分
  volumeFloor: 100, // 互动低于 100 记 0
  volumeCap: 20000, // 互动 2 万记满分
  freshnessHalfLifeDays: 14,
  freshnessFloor: 0.6, // 老笔记最多打 6 折 —— 常青选题仍有参考价值
  viralOutlier: 3,
  viralMinInteractions: 500,
  lowFanMaxFollowers: 5000,
  lowFanMinInteractions: 1000,
};

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 互动量：赞 + 藏 + 评（分享多数接口拿不到，不计入） */
export const interactions = (n) => n.likes + n.collects + n.comments;

/**
 * @param {import('./normalize.mjs').Note} note
 * @param {{followers?: number, baseline?: number, now?: Date, prev?: {interactions:number, syncedAt:string}}} ctx
 */
export function scoreNote(note, ctx = {}, cfg = DEFAULT_SCORING) {
  const I = interactions(note);
  const F = ctx.followers ?? 0;
  const baseline = ctx.baseline ?? 0;
  const now = ctx.now ?? new Date();

  const outlier = baseline > 0 ? I / baseline : null;
  const fanRatio = F > 0 ? I / F : null;
  const collectRatio = note.likes > 0 ? note.collects / note.likes : 0;
  const commentRatio = note.likes > 0 ? note.comments / note.likes : 0;
  const ageDays = note.publishedAt ? Math.max(0, (now - new Date(note.publishedAt)) / 864e5) : null;

  const parts = {
    // 1x → 0，cap 倍 → 1；没有基线时给中性 0.3
    outlier: outlier == null ? 0.3 : clamp01(Math.log(Math.max(outlier, 1)) / Math.log(cfg.outlierCap)),
    // 赞粉比 0.01 → 0，≥1 → 1；不知道粉丝数给中性 0.3
    fanRatio: fanRatio == null ? 0.3 : clamp01((Math.log10(Math.max(fanRatio, 1e-6)) + 2) / 2),
    volume: clamp01(Math.log10(Math.max(I, 1) / cfg.volumeFloor) / Math.log10(cfg.volumeCap / cfg.volumeFloor)),
    // 藏/赞 0.3 → 0，≥1.2 → 1（AI 教程类笔记收藏往往高于点赞）
    collect: clamp01((collectRatio - 0.3) / 0.9),
    // 评/赞 ≥ 0.15 记满分
    comment: clamp01(commentRatio / 0.15),
  };

  const w = cfg.weights;
  const raw = Object.keys(w).reduce((s, k) => s + w[k] * parts[k], 0);
  const freshness =
    ageDays == null ? 0.8 : cfg.freshnessFloor + (1 - cfg.freshnessFloor) * Math.pow(0.5, ageDays / cfg.freshnessHalfLifeDays);
  const score = Math.round(100 * raw * freshness);

  const tags = [];
  if (outlier != null && outlier >= cfg.viralOutlier && I >= cfg.viralMinInteractions) tags.push("爆款");
  if (F > 0 && F <= cfg.lowFanMaxFollowers && I >= cfg.lowFanMinInteractions) tags.push("低粉爆文");
  if (note.collects > note.likes && I >= 200) tags.push("干货收藏型");
  if (commentRatio >= 0.1 && note.comments >= 30) tags.push("讨论型");
  if (ageDays != null && ageDays <= 3) tags.push("新");

  let growthPerDay = null;
  if (ctx.prev?.syncedAt) {
    const days = (now - new Date(ctx.prev.syncedAt)) / 864e5;
    if (days > 0.2) growthPerDay = Math.round((I - ctx.prev.interactions) / days);
  }
  if (growthPerDay != null && growthPerDay >= 200) tags.push("正在涨");

  return {
    score,
    interactions: I,
    outlier: outlier == null ? null : round2(outlier),
    fanRatio: fanRatio == null ? null : round2(fanRatio),
    collectRatio: round2(collectRatio),
    commentRatio: round2(commentRatio),
    ageDays: ageDays == null ? null : Math.round(ageDays),
    growthPerDay,
    tags,
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * 对同一账号的一批笔记打分。
 * 基线 = 该账号「其他」笔记的互动中位数（留一法），避免爆款把自己的基线拉高。
 */
export function scoreAccountNotes(notes, { followers, now, prevById = {} } = {}, cfg = DEFAULT_SCORING) {
  const all = notes.map(interactions);
  return notes.map((n, i) => {
    const others = all.filter((_, j) => j !== i);
    const baseline = others.length ? median(others) : 0;
    return { note: n, metrics: scoreNote(n, { followers, baseline, now, prev: prevById[n.id] }, cfg) };
  });
}
