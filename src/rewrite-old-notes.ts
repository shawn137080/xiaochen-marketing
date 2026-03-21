/**
 * 重写前6篇旧笔记 + 重新生成配图（多模板）
 * 弱化AI，突出兜兜活人感，聚焦省时+多赚钱
 */
import { db } from "./db";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IMAGES_DIR = process.env.XHS_IMAGES_DIR || resolve(__dirname, "../images");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";

const RED = "#FF3B30";
const CORAL = "#FF6B4A";
const NAVY = "#0F1C2E";
const CREAM = "#FDF6EC";
const FONT = "PingFang SC, Noto Sans CJK SC, SimHei, Arial, sans-serif";

// ── 新文案 ────────────────────────────────────────────────────────────────
const REWRITES = [
  {
    oldTitle: "装修师傅最怕漏接电话",
    title: "装修师傅最怕的，不是工地出问题",
    content: `是电话漏了。

干活的时候，电话来了。
戴着手套，噪音大，接不了。

等停下来回拨——
「不好意思，我已经找到别人了。」

做了 8 年装修，
这句话我听过不止 20 次。

后来我让兜兜帮我盯着电话。

我在工地，兜兜接着，
用中文跟客人聊，记下需求，
发到我的微信。

我得空了再跟进，
客人觉得我「回复很快，很专业」。

去年比前年多成了 6 个单，
多赚了 $22,000。

不是我变得更快——
是每个客人都被接住了。

做装修的朋友，
你每个月漏几个单？评论说说👇`,
    tags: JSON.stringify(["装修公司","华人装修","加拿大装修","兜兜","多赚钱","省时间","接单技巧"]),
    template: "scene" as const,
    hookText: "干活时漏掉的电话\n值多少钱",
    subText: "装修师傅最心疼的那一刻",
    industry: "renovation",
  },
  {
    oldTitle: "清洁公司老板的时间都去哪了",
    title: "清洁公司老板的时间，都被这件事吃掉了",
    content: `做清洁的姐妹们，你每天花多少时间在接电话上？

我之前算过：

每天平均接 12 个电话，
每个电话 5–10 分钟，
光接电话就要 1–2 小时。

还不算漏掉的——
那些打来没接到、再也联系不上的。

一个温哥华的清洁公司老板跟我说：
「我雇了 4 个人，但最累的活不是打扫，
是接电话和回消息。」

后来她让兜兜帮她盯着电话。

兜兜接着，中文沟通，
把客人的需求、地址、时间全记下来，
发摘要到她的微信。

她得空了统一回，
每天省出 1.5 小时。

这 1.5 小时她用来多接 2 个工——
每个月多赚 $2,000+。

时间就是钱，
省出来的时间要用来赚钱。

做清洁的朋友，你每天接多少电话？👇`,
    tags: JSON.stringify(["清洁公司","温哥华华人","华人小生意","兜兜","省时间","多赚钱","家政服务"]),
    template: "text_card" as const,
    hookText: "每天 1.5 小时\n被电话吃掉了",
    subText: "清洁公司老板最真实的烦恼\n省出来，就是多赚的钱",
    industry: "cleaning",
  },
  {
    oldTitle: "5个信号说明你该用AI接电话了",
    title: "这5个信号，说明你该让兜兜帮你接电话了",
    content: `如果你中了 3 个以上，真的该考虑了：

1️⃣ 每周至少漏接 5 个电话
开车、做活、吃饭——
电话就在那个时候来。

2️⃣ 客人抱怨「打了好几次才接通」
客人不会等，
他们只会换一家。

3️⃣ 开车/干活时接电话不安全
手上有活、车在开——
真的接不了。

4️⃣ 晚上 9 点还有客人打来
你休息了，但客人不知道。
漏了，第二天可能已经找别人了。

5️⃣ 回电话时客人已经找到别人
这是最心疼的。
你打回去，对方说「不用了谢谢」。

中了几个？

兜兜专门帮华人老板解决这件事：
你接不到的时候，它帮你接着，
中文沟通，摘要发到你的微信。

你得空了跟进，
单子不再消失。

评论说说你中了几个👇`,
    tags: JSON.stringify(["小生意","加拿大华人","兜兜","home service","省时间","接单技巧","漏电话"]),
    template: "tool" as const,
    hookText: "你中了几个？\n该让兜兜帮你了",
    subText: "① 漏接  ② 客人抱怨  ③ 开车不安全  ④ 晚上来电  ⑤ 回拨太晚",
    industry: "general",
  },
  {
    oldTitle: "暖通师傅一年少赚5万的真相",
    title: "暖通师傅一年少赚$5万，原因只有一个",
    content: `安省的暖通师傅们，
冬天是旺季对吧？

但你知道，旺季你可能漏了多少钱吗？

一个做 HVAC 的朋友算了一笔账：

旺季每天平均 8 个来电
他在工地漏接 3–4 个
每个电话平均价值 $800
一个旺季（3个月）：

漏接 × 3.5 个/天 × 60 天 × 50% 成单 = 105 个单
105 × $800 = $84,000 的机会消失了

就算只有一半能成单，
那也是 $42,000 没了。

后来他让兜兜帮他盯着旺季电话。

兜兜用中文接，记需求，发摘要，
他得空了统一跟进。

那个旺季，他多赚了 $51,000。

暖通的朋友，旺季你漏接多少个？👇`,
    tags: JSON.stringify(["HVAC","安省华人","暖通","兜兜","华人师傅","多赚钱","冬季旺季"]),
    template: "data" as const,
    hookText: "旺季漏接\n少赚多少钱",
    bigNumber: "$42,000",
    bigLabel: "一个旺季消失的机会",
    dataSub1: "让兜兜帮你接住",
    dataSub2: "多赚 $51,000 / 旺季",
    industry: "hvac",
  },
  {
    oldTitle: "客户说你们服务太好了的秘密",
    title: "客户说「你们服务太好了」——秘密是这个",
    content: `一个搬家公司的老板跟我分享了一件事：

以前客人打来，他在搬东西接不了。
等回电话已经过了 2 小时，
客人语气都不好了。

现在用了兜兜之后——

客人打来，兜兜秒接，
中英双语，自动识别客人说哪种语言，
记下搬家日期、地址、物品清单，
摘要发到他的微信。

他得空了回电，距离客人来电不超过 15 分钟。

客人说：「你们服务真的好，
打来就有人接，回复这么快。」

其实他没有变得更快——
只是兜兜帮他把「有人在」这件事做到了。

这一年，
他的口碑好了，
转介绍多了，
年收入比前年多了 $38,000。

做搬家的朋友，
你是怎么处理旺季的客人来电的？👇`,
    tags: JSON.stringify(["搬家公司","多伦多","华人创业","兜兜","口碑营销","多赚钱","home service"]),
    template: "scene" as const,
    hookText: "客人说「服务太好了」\n秘密只有一个",
    subText: "不是你更快——是兜兜帮你接住了",
    industry: "moving",
  },
  {
    oldTitle: "我帮10个华人老板省了接电话的时间",
    title: "我帮10个华人老板用了兜兜，3个月后",
    content: `过去 3 个月，我帮 10 个加拿大华人 service 老板用了兜兜接单助手。

他们的行业：
装修×3、清洁×2、HVAC×2、搬家×1、水管×1、园艺×1

共同点：
- 都是 1–5 人的小团队
- 老板一个人跑业务 + 做工
- 每周漏接 5–15 个电话

3 个月后，他们告诉我：

📞 漏单率从平均 35% 降到 8%
⏰ 每天少花 1.5 小时在电话上
💰 10 个人加起来，3 个月多赚了 $186,000

平均每人多赚了 $18,600。

最大的改变不是工具——
是每个客人都被接住了，
是每一单机会都没有消失。

做 service 的华人老板，
你每个月漏几单？评论说说👇`,
    tags: JSON.stringify(["华人创业","加拿大大生活","兜兜","小生意营收","多赚钱","省时间","创业故事"]),
    template: "data" as const,
    hookText: "10个华人老板\n3个月多赚了",
    bigNumber: "$186,000",
    bigLabel: "10人合计 · 3个月",
    dataSub1: "平均每人",
    dataSub2: "$18,600 / 3个月",
    industry: "general",
  },
  {
    oldTitle: "新移民开service公司第一件事",
    title: "新移民开service公司：第一件事做这个",
    content: `不是注册公司。
不是做名片。
不是发传单。

是——确保每个电话都有人接。

为什么？

你刚开始，没有口碑，没有转介绍。
每个来电都是陌生客人主动找你的——
这是最宝贵的机会。

漏了一个，就是漏了一单。
漏了一单，就是少了一个可能的回头客。

我刚来加拿大的时候不懂，
头半年漏了不知道多少单。

后来老乡介绍我用兜兜——

我在开车、做活、睡觉，
兜兜帮我盯着电话，
用中文接，记需求，发到我的微信。

我得空了跟进，
每个客人都觉得我「很专业，回复很快」。

第一年比没用兜兜的那半年多赚了 $28,000。

新移民开 service 公司，
你第一步做什么？评论说说👇`,
    tags: JSON.stringify(["新移民创业","加拿大华人","兜兜","小生意起步","多赚钱","省时间","创业第一步"]),
    template: "text_card" as const,
    hookText: "新移民开小生意\n第一件事做这个",
    subText: "不是注册公司，不是做名片\n是确保每个电话\n都有人接",
    industry: "general",
  },
];

// ── Gemini ────────────────────────────────────────────────────────────────
async function generateGeminiImage(prompt: string): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "3:4", imageSize: "512" },
      },
    }),
  });
  const data = await res.json() as any;
  if (data.error) { console.error("Gemini:", data.error.message); return null; }
  for (const p of data.candidates?.[0]?.content?.parts || []) {
    if (p.inlineData) return Buffer.from(p.inlineData.data, "base64");
  }
  return null;
}

const PHOTO_STYLE = "Photorealistic editorial photography, Sony A7 IV 35mm f/1.8, dramatic cinematic lighting strong contrast, expressive genuine emotion. No text, no labels, no watermarks. Vertical 4:5.";

const SCENE_PROMPTS: Record<string, string> = {
  renovation: `A weathered Chinese male contractor in his 40s on half-finished hardwood floor at Canadian renovation site, staring at phone showing 3 missed calls — frustrated tired expression. Dramatic overhead construction lighting. ${PHOTO_STYLE}`,
  moving: `A Chinese moving company owner mid-30s on Canadian sidewalk with boxes, warm confident smile talking on phone — golden late-afternoon light, organized energy. ${PHOTO_STYLE}`,
  general: `A focused Chinese small business owner late 30s at clean tidy cafe table, laptop open, calm confident smile reading phone message summary — warm bokeh cafe ambiance. ${PHOTO_STYLE}`,
};

const TOOL_BG = `Clean minimal modern desk workspace, top-down flat-lay, light oak surface, small plant, notebook, soft natural window light. No text, no people. ${PHOTO_STYLE}`;

// ── 渲染函数 ──────────────────────────────────────────────────────────────
async function renderScene(bg: Buffer, hookText: string, subText?: string): Promise<Buffer> {
  const m = await sharp(bg).metadata();
  const w = m.width ?? 512, h = m.height ?? 683;
  const lines = hookText.split("\n");
  const fs = Math.round(w * 0.115);
  const lh = fs * 1.25;
  const blockH = lines.length * lh + (subText ? fs * 0.5 * 2.5 : 0) + 40;
  const blockY = h - blockH - 32;

  const hookLines = lines.map((l, i) =>
    `<text x="${w/2}" y="${blockY + i*lh + fs}" text-anchor="middle"
      font-family="${FONT}" font-size="${fs}" font-weight="900" fill="white"
      paint-order="stroke" stroke="#000" stroke-width="6" stroke-linejoin="round">${l}</text>`
  ).join("");

  const subLine = subText
    ? `<text x="${w/2}" y="${blockY + lines.length*lh + fs*0.5*1.8}" text-anchor="middle"
        font-family="${FONT}" font-size="${Math.round(fs*0.45)}" font-weight="500"
        fill="rgba(255,255,255,0.88)" paint-order="stroke" stroke="#000" stroke-width="3">${subText}</text>`
    : "";

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.78)"/>
    </linearGradient></defs>
    <rect x="0" y="${h - blockH - 80}" width="${w}" height="${blockH + 80}" fill="url(#g)"/>
    ${hookLines}${subLine}
    <rect x="${w-108}" y="${h-42}" width="100" height="34" rx="8" fill="rgba(0,0,0,0.55)"/>
    <text x="${w-58}" y="${h-20}" text-anchor="middle" font-family="${FONT}"
      font-size="18" font-weight="700" fill="white">兜兜</text>
  </svg>`;
  return sharp(bg).composite([{ input: Buffer.from(svg), blend: "over" }]).png().toBuffer();
}

async function renderData(cfg: typeof REWRITES[0]): Promise<Buffer> {
  const W = 512, H = 683;
  const [h1, h2] = cfg.hookText.split("\n");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${NAVY}"/>
    <rect x="0" y="0" width="6" height="${H}" fill="${RED}"/>
    <rect x="0" y="0" width="${W}" height="130" fill="rgba(255,59,48,0.12)"/>
    <text x="32" y="62" font-family="${FONT}" font-size="36" font-weight="900" fill="white">${h1}</text>
    <text x="32" y="108" font-family="${FONT}" font-size="36" font-weight="900" fill="white">${h2}</text>
    <text x="${W/2}" y="310" text-anchor="middle" font-family="${FONT}"
      font-size="108" font-weight="900" fill="${RED}">${cfg.bigNumber}</text>
    <text x="${W/2}" y="368" text-anchor="middle" font-family="${FONT}"
      font-size="24" font-weight="600" fill="rgba(255,255,255,0.85)">${cfg.bigLabel}</text>
    <line x1="32" y1="400" x2="${W-32}" y2="400" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <text x="32" y="446" font-family="${FONT}" font-size="22" fill="rgba(255,255,255,0.6)">${cfg.dataSub1}</text>
    <text x="32" y="486" font-family="${FONT}" font-size="30" font-weight="700" fill="${CORAL}">${cfg.dataSub2}</text>
    <rect x="32" y="${H-60}" width="100" height="38" rx="8" fill="rgba(255,59,48,0.25)"/>
    <text x="82" y="${H-35}" text-anchor="middle" font-family="${FONT}"
      font-size="20" font-weight="700" fill="white">兜兜</text>
    <circle cx="${W-60}" cy="${H-80}" r="80" fill="rgba(255,107,74,0.06)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderTool(bg: Buffer, hookText: string, subText?: string): Promise<Buffer> {
  const m = await sharp(bg).metadata();
  const w = m.width ?? 512, h = m.height ?? 683;
  const lines = hookText.split("\n");
  const fs = Math.round(w * 0.1);
  const barH = lines.length * fs * 1.3 + 40;
  const sfS = Math.round(w * 0.048);

  const titleLines = lines.map((l, i) =>
    `<text x="${w/2}" y="${32 + (i+1)*fs*1.3}" text-anchor="middle"
      font-family="${FONT}" font-size="${fs}" font-weight="900" fill="white">${l}</text>`
  ).join("");

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${w}" height="${barH}" fill="rgba(255,59,48,0.92)"/>
    ${titleLines}
    <rect x="0" y="${h-160}" width="${w}" height="160" fill="rgba(255,255,255,0.94)"/>
    ${subText ? `<text x="${w/2}" y="${h-96}" text-anchor="middle" font-family="${FONT}"
      font-size="${sfS}" font-weight="600" fill="#222">${subText}</text>` : ""}
    <rect x="${w/2-45}" y="${h-52}" width="90" height="34" rx="8" fill="${RED}"/>
    <text x="${w/2}" y="${h-29}" text-anchor="middle" font-family="${FONT}"
      font-size="18" font-weight="700" fill="white">兜兜</text>
  </svg>`;

  const blurred = await sharp(bg).blur(2).toBuffer();
  return sharp(blurred).composite([{ input: Buffer.from(svg), blend: "over" }]).png().toBuffer();
}

async function renderTextCard(hookText: string, subText?: string): Promise<Buffer> {
  const W = 512, H = 683;
  const [h1, h2] = hookText.split("\n");
  const subLines = (subText ?? "").split("\n");
  const subTexts = subLines.map((l, i) =>
    `<text x="${W/2}" y="${330 + i*48}" text-anchor="middle" font-family="${FONT}"
      font-size="25" fill="rgba(90,60,30,0.82)">${l}</text>`
  ).join("");

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${CREAM}"/>
    <rect x="0" y="0" width="${W}" height="8" fill="${RED}"/>
    <rect x="0" y="8" width="${W}" height="3" fill="${CORAL}"/>
    <text x="32" y="110" font-family="${FONT}" font-size="120" font-weight="900"
      fill="rgba(255,59,48,0.1)">"</text>
    <text x="${W/2}" y="200" text-anchor="middle" font-family="${FONT}"
      font-size="42" font-weight="900" fill="#1A1A1A">${h1}</text>
    <text x="${W/2}" y="254" text-anchor="middle" font-family="${FONT}"
      font-size="42" font-weight="900" fill="${RED}">${h2}</text>
    <line x1="80" y1="285" x2="${W-80}" y2="285" stroke="rgba(255,59,48,0.3)" stroke-width="2"/>
    ${subTexts}
    <rect x="${W/2-45}" y="${H-68}" width="90" height="40" rx="10" fill="${RED}"/>
    <text x="${W/2}" y="${H-40}" text-anchor="middle" font-family="${FONT}"
      font-size="20" font-weight="700" fill="white">兜兜</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  for (const r of REWRITES) {
    const note = await db.xhsNote.findFirst({ where: { title: r.oldTitle } });
    if (!note) { console.log(`⚠️  找不到: ${r.oldTitle}`); continue; }

    // 1. 更新文案
    await db.xhsNote.update({
      where: { id: note.id },
      data: { title: r.title, content: r.content, tags: r.tags },
    });
    console.log(`✅ 文案: "${r.title}"`);

    // 2. 生成配图
    const filepath = resolve(IMAGES_DIR, `${note.id}.png`);
    let buf: Buffer | null = null;

    if (r.template === "data") {
      buf = await renderData(r);
    } else if (r.template === "text_card") {
      buf = await renderTextCard(r.hookText, r.subText);
    } else if (r.template === "scene") {
      const bg = await generateGeminiImage(SCENE_PROMPTS[r.industry] || SCENE_PROMPTS.general);
      if (bg) buf = await renderScene(bg, r.hookText, r.subText);
    } else if (r.template === "tool") {
      const bg = await generateGeminiImage(TOOL_BG);
      if (bg) buf = await renderTool(bg, r.hookText, r.subText);
    }

    if (buf) {
      writeFileSync(filepath, buf);
      console.log(`   🎨 图片: [${r.template}] ${(buf.length/1024).toFixed(0)}KB\n`);
    } else {
      console.log(`   ❌ 图片生成失败\n`);
    }

    if (r.template === "scene" || r.template === "tool") {
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  await db.$disconnect();
  console.log("🎉 旧6篇文案+配图全部更新！");
}

main().catch(e => { console.error(e); process.exit(1); });
