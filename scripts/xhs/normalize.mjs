// 把不同 Apify actor / 数据 API 的返回统一成内部结构。
// 不同 actor 字段名不一致，所以这里按候选路径依次尝试。

/** "1.2万" / "1.2w" / "10+" / "3,456" / 123 → number */
export function parseCount(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/,/g, "").replace(/\+$/, "");
  const m = s.match(/^([\d.]+)\s*(万|w|W|千|k|K|亿)?$/);
  if (!m) return Number(s) || 0;
  const n = parseFloat(m[1]);
  const unit = { 万: 1e4, w: 1e4, W: 1e4, 千: 1e3, k: 1e3, K: 1e3, 亿: 1e8 }[m[2]] ?? 1;
  return Math.round(n * unit);
}

function get(obj, p) {
  return p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function pick(obj, paths) {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** 秒 / 毫秒 / ISO 字符串 → ISO 字符串 */
export function parseTime(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const ROOTS = ["", "note_card.", "noteCard.", "note.", "data."];
const withRoots = (paths) => ROOTS.flatMap((r) => paths.map((p) => r + p));

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {"video"|"normal"} type
 * @property {number} likes
 * @property {number} collects
 * @property {number} comments
 * @property {number} shares
 * @property {string|null} publishedAt
 * @property {string} userId
 * @property {string} nickname
 * @property {string} url
 * @property {string} cover
 * @property {string[]} tags
 */

/** @returns {Note|null} */
export function normalizeNote(raw) {
  const id = pick(raw, withRoots(["note_id", "noteId", "id"]));
  if (!id) return null;
  const xsec = pick(raw, withRoots(["xsec_token", "xsecToken"]));
  const tagsRaw = pick(raw, withRoots(["tag_list", "tagList", "tags", "hashtags"])) ?? [];
  const typeRaw = String(pick(raw, withRoots(["type", "note_type", "noteType"])) ?? "normal");
  return {
    id: String(id),
    title: String(pick(raw, withRoots(["title", "display_title", "displayTitle"])) ?? "").trim(),
    desc: String(pick(raw, withRoots(["desc", "content", "description", "text"])) ?? "").trim(),
    type: /video/i.test(typeRaw) ? "video" : "normal",
    likes: parseCount(pick(raw, withRoots(["liked_count", "likedCount", "likes", "like_count", "likeCount", "interact_info.liked_count", "interactInfo.likedCount"]))),
    collects: parseCount(pick(raw, withRoots(["collected_count", "collectedCount", "collects", "collect_count", "collectCount", "interact_info.collected_count", "interactInfo.collectedCount"]))),
    comments: parseCount(pick(raw, withRoots(["comment_count", "commentCount", "comments_count", "commentsCount", "interact_info.comment_count", "interactInfo.commentCount"]))),
    shares: parseCount(pick(raw, withRoots(["share_count", "shareCount", "shared_count", "sharedCount", "interact_info.share_count", "interactInfo.shareCount"]))),
    publishedAt: parseTime(pick(raw, withRoots(["time", "publish_time", "publishTime", "create_time", "createTime", "timestamp", "published_at", "postedAt"]))),
    userId: String(pick(raw, withRoots(["user.user_id", "user.userId", "user.id", "author.user_id", "author.id", "user_id", "userId"])) ?? ""),
    nickname: String(pick(raw, withRoots(["user.nickname", "user.nick_name", "author.nickname", "nickname", "author_name"])) ?? ""),
    url:
      pick(raw, withRoots(["url", "note_url", "noteUrl", "link"])) ??
      `https://www.xiaohongshu.com/explore/${id}${xsec ? `?xsec_token=${encodeURIComponent(xsec)}` : ""}`,
    cover: String(pick(raw, withRoots(["cover.url_default", "cover.url", "cover", "image_list.0.url", "imageList.0.urlDefault", "images.0"])) ?? ""),
    tags: (Array.isArray(tagsRaw) ? tagsRaw : [])
      .map((t) => (typeof t === "string" ? t : t?.name))
      .filter(Boolean)
      .map((t) => String(t).replace(/^#|\[话题\]#?$/g, "")),
  };
}

/**
 * @typedef {Object} Profile
 * @property {string} userId
 * @property {string} redId
 * @property {string} nickname
 * @property {string} desc
 * @property {number} followers
 * @property {number} totalLikesCollects
 */

/** @returns {Profile|null} */
export function normalizeProfile(raw) {
  const roots = ["", "basic_info.", "basicInfo.", "user.", "data.", "userInfo."];
  const p = (paths) => pick(raw, roots.flatMap((r) => paths.map((x) => r + x)));
  // 部分接口把粉丝数放在 interactions: [{type:"fans", count:"1.2万"}]
  const interactions = p(["interactions"]);
  const fromInteractions = (type) =>
    Array.isArray(interactions) ? interactions.find((i) => i?.type === type)?.count : undefined;
  const userId = p(["user_id", "userId", "id"]);
  const redId = p(["red_id", "redId", "xhs_id"]);
  if (!userId && !redId) return null;
  return {
    userId: String(userId ?? ""),
    redId: String(redId ?? ""),
    nickname: String(p(["nickname", "nick_name", "name"]) ?? ""),
    desc: String(p(["desc", "description", "bio"]) ?? ""),
    followers: parseCount(p(["fans", "followers", "follower_count", "fansCount", "fans_count"]) ?? fromInteractions("fans")),
    totalLikesCollects: parseCount(p(["liked_and_collected", "interaction", "likes_and_collects"]) ?? fromInteractions("interaction")),
  };
}

/** 从主页链接提取 user_id：xiaohongshu.com/user/profile/<24位hex> */
export function userIdFromUrl(url) {
  const m = String(url ?? "").match(/user\/profile\/([0-9a-f]{24})/i);
  return m ? m[1] : "";
}
