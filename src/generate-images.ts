/**
 * 用 Gemini API 为排期笔记生成配图
 * 文字直接嵌入 Gemini prompt，不用 sharp SVG overlay（避免 Docker 中文字体乱码）
 */
import { db } from "./db";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const IMAGES_DIR = process.env.XHS_IMAGES_DIR || resolve(__dirname, "../images");

// ── 模板类型 ──────────────────────────────────────────────────────────────
type Template = "scene" | "data" | "tool" | "before_after" | "text_card";

interface NoteImageConfig {
  template: Template;
  hookText: string;       // 大字钩子（2行，用\n分隔）
  subText?: string;
  bigNumber?: string;
  bigLabel?: string;
  dataSub1?: string;
  dataSub2?: string;
}

const NOTE_CONFIGS: Record<string, NoteImageConfig> = {
  "美容师做着项目，电话又断了": {
    template: "scene",
    hookText: "做着项目\n电话又断了",
    subText: "你不知道那头是谁",
  },
  "我统计了30天：消失的电话值多少钱": {
    template: "data",
    hookText: "消失的电话\n值多少钱",
    bigNumber: "11个",
    bigLabel: "潜在客户就这样消失了",
    dataSub1: "每月漏接损失",
    dataSub2: "$3,000 – $6,000",
  },
  "华人小老板开店必装的3个AI工具": {
    template: "tool",
    hookText: "华人老板必装\n3个AI工具",
    subText: "① AI接电话  ② 自动预约  ③ 报价模板",
  },
  "补习班招生季，漏一个电话损失多少": {
    template: "data",
    hookText: "漏一个电话\n损失多少钱",
    bigNumber: "$3,000",
    bigLabel: "一个家长来电的价值",
    dataSub1: "学生平均留存 8–10 个月",
    dataSub2: "$150–300/月 × 10 = 你算",
  },
  "水管师傅开车途中，那个电话断了": {
    template: "scene",
    hookText: "开车途中\n那个电话断了",
    subText: "等你回拨，他已找到别人",
  },
  "装修老板实测90天：AI接电话真实数据": {
    template: "data",
    hookText: "实测90天\n成单数据来了",
    bigNumber: "+133%",
    bigLabel: "成单数提升",
    dataSub1: "额外收入",
    dataSub2: "$45,000 / 3个月",
  },
  "美甲店零漏单的秘密：就这一个设置": {
    template: "tool",
    hookText: "美甲店零漏单\n就这1步设置",
    subText: "5分钟搞定，客人说「你们好专业」",
  },
  "AI时代，不用AI的老板输在哪里": {
    template: "before_after",
    hookText: "用AI和没用\n差距已经出来了",
  },
  "割草旺季到了，一个人怎么接得过来": {
    template: "scene",
    hookText: "旺季电话不停\n一个人怎么接",
    subText: "漏一个，就是漏一单",
  },
  "搬家旺季：有AI接电话和没有的区别": {
    template: "before_after",
    hookText: "旺季多接30%的单\n他就靠这一个变化",
  },
  "来加拿大创业2年，我最后悔的一件事": {
    template: "text_card",
    hookText: "来加拿大创业 2 年\n最后悔的一件事",
    subText: "不是选错行业，不是定价太低\n是没有早点让 AI 帮我接电话",
  },
  "空调季来了，暖通师傅你接得过来吗": {
    template: "scene",
    hookText: "空调季到了\n你接得过来吗",
    subText: "旺季每漏一个，损失的不只是一单",
  },
  "清洁公司收到差评那天，我反思了这件事": {
    template: "scene",
    hookText: "因为没接电话\n我收到了差评",
    subText: "客人不在乎你多努力，只在乎有没有人接",
  },
  "为什么同行接单比你快？就差这一步": {
    template: "tool",
    hookText: "同行接单\n为什么比你快",
    subText: "就差这一步 →",
  },
};

// 行业对应场景 prompt
const SCENE_PROMPTS: Record<string, string> = {
  beauty: "A Chinese female aesthetician in her 30s in white uniform, carefully applying face mask on a client, phone visible showing missed call — conflicted anxious glance toward it. Warm peachy salon light.",
  plumbing: "A Chinese plumber in his 30s in a work truck cab, staring at phone screen showing missed call with a helpless expression — warm interior truck light, raindrops on windshield.",
  landscaping: "A Chinese landscaper in his 30s kneeling in a lush Canadian suburban garden, vibrating phone just out of reach — dramatic summer noon light, urgency in his face.",
  hvac: "A Chinese HVAC technician in insulated jacket on a Canadian rooftop, phone in gloved hand showing several missed calls — overcast sky, expression of quiet frustration.",
  cleaning: "A Chinese female cleaning company owner in her 40s standing outside a house she just finished, holding phone showing missed-call notification, slight tired-but-determined expression. Soft golden afternoon light.",
  renovation: "A weathered Chinese male contractor in his 40s sitting on half-finished hardwood floor, sawdust on clothes, staring at phone showing 3 missed calls with a strained tired expression. Dramatic overhead construction lighting.",
  general: "A focused Chinese small business owner in his late 30s at a cafe table, laptop open, looking at phone showing missed calls — warm mood lighting, expression of quiet frustration.",
};

const SPLIT_SCENE: Record<string, string> = {
  general: "A Chinese small business owner in his 40s: top half shows him at chaotic cluttered desk, phone blazing with 6 missed calls, visibly overwhelmed under harsh late-night lamp; bottom half shows same man at minimalist tidy desk, coffee in hand, phone showing organized call log, confident half-smile in crisp morning light.",
  moving: "A Chinese moving company owner 30s: top half shows him surrounded by cardboard boxes on Canadian sidewalk, staring at ringing phone under harsh midday sun; bottom half shows same man calmly reviewing client list on phone at desk with soft indoor evening light.",
};

interface GeminiResponse {
  candidates?: Array<{ content: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
  error?: { message: string };
}

async function callGemini(prompt: string): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "3:4" },
      },
    }),
  });
  const data = (await res.json()) as GeminiResponse;
  if (data.error) { console.error(`   Gemini error: ${data.error.message}`); return null; }
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

// ── 模板 prompts ──────────────────────────────────────────────────────────

function buildScenePrompt(cfg: NoteImageConfig, industry: string): string {
  const scene = SCENE_PROMPTS[industry] || SCENE_PROMPTS.general;
  const [line1, line2] = cfg.hookText.split("\n");
  return `Photorealistic editorial photography, Sony A7 IV 35mm f/1.8, dramatic cinematic lighting, vivid color grading. Vertical 3:4 ratio.

Scene: ${scene}

In the lower third of the image, add a dark gradient overlay (transparent to black) with the following Chinese text rendered in clean bold white sans-serif font:
- Large headline line 1: "${line1}"
- Large headline line 2: "${line2}"
${cfg.subText ? `- Smaller subtitle below: "${cfg.subText}"` : ""}

In the bottom-right corner, add a small dark semi-transparent rounded pill label with white text "兜兜AI".

The Chinese text must be clearly legible, correctly rendered, no typos.`;
}

function buildDataPrompt(cfg: NoteImageConfig): string {
  const [h1, h2] = cfg.hookText.split("\n");
  return `Design a professional Chinese social media infographic card, vertical 3:4 ratio, dark navy blue background (#0F1C2E).

Layout (top to bottom):
1. Top header area with subtle dark red tint, containing bold white Chinese text:
   Line 1: "${h1}"
   Line 2: "${h2}"
2. A thin bright red left border accent on the entire card.
3. Center: giant bold red number/text "${cfg.bigNumber ?? ""}" taking up much of the width.
4. Below the number: white Chinese text "${cfg.bigLabel ?? ""}"
5. Thin horizontal separator line.
6. Two lines of supporting data:
   Gray text: "${cfg.dataSub1 ?? ""}"
   Coral/orange bold text: "${cfg.dataSub2 ?? ""}"
7. Bottom-left: small red rounded rectangle badge with white text "兜兜AI".

All Chinese text must be correctly rendered, clean modern sans-serif, no decorative elements, pure graphic design style.`;
}

function buildToolPrompt(cfg: NoteImageConfig, industry: string): string {
  const [line1, line2] = cfg.hookText.split("\n");
  const bgDesc = industry === "beauty"
    ? "Clean minimal beauty salon station, top-down view, white marble surface, small rose gold details, soft warm light. No text, no people."
    : "Clean minimal modern desk workspace, top-down flat-lay, light oak wood surface, small succulent, phone, notebook, soft natural window light. No text, no people.";

  return `${bgDesc} Vertical 3:4 ratio.

Overlay the following graphic elements on this background:
1. Top: vivid red banner (#FF3B30) spanning the full width, containing bold white Chinese text centered:
   Line 1: "${line1}"
   Line 2: "${line2}"
2. Bottom: semi-transparent white frosted card area (last ~25% of image height) with Chinese text centered:
   "${cfg.subText ?? ""}"
3. At the very bottom center: a small vivid red rounded button with white text "兜兜AI".

All Chinese text must be correctly rendered, clean sans-serif, clearly legible.`;
}

function buildBeforeAfterPrompt(cfg: NoteImageConfig, noteTitle: string): string {
  const industry = noteTitle.includes("搬家") ? "moving" : "general";
  const scene = SPLIT_SCENE[industry] || SPLIT_SCENE.general;
  const [h1, h2] = cfg.hookText.split("\n");
  const centerText = noteTitle.includes("搬家") ? "旺季多接30%的单" : "用AI和没用，差距出来了";

  return `Vertical split photo composition, 3:4 ratio. ${scene}

Add these text overlays:
1. Top-left: dark semi-transparent rounded pill with bold white Chinese text "以前"
2. Center horizontal divider strip (dark semi-transparent band) with bold red Chinese text: "${centerText}"
3. Bottom-left: dark semi-transparent rounded pill with bold white Chinese text "现在"
4. Bottom-right corner: small dark rounded pill "兜兜AI" in white

Also, the overall image should evoke the concept: "${h1} ${h2}"

All Chinese text must be correctly rendered, clean and legible.`;
}

function buildTextCardPrompt(cfg: NoteImageConfig): string {
  const [h1, h2] = cfg.hookText.split("\n");
  const subLines = (cfg.subText ?? "").split("\n");

  return `Design a clean warm Chinese social media text card, vertical 3:4 ratio.

Background: warm cream color (#FDF6EC).

Layout:
1. Very top: thin vivid red accent stripe across full width.
2. Upper area: large decorative quotation mark in very light red (nearly invisible, decorative).
3. Center headline (large bold Chinese text):
   Black: "${h1}"
   Red (#FF3B30): "${h2}"
4. Below: thin red horizontal divider line.
5. Body text (smaller, warm brown, centered):
${subLines.map(l => `   "${l}"`).join("\n")}
6. Bottom center: small vivid red (#FF3B30) rounded rectangle button with white text "兜兜AI".

All Chinese text must be correctly rendered, modern clean sans-serif typography, no photos.`;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  if (!GEMINI_API_KEY) { console.error("GEMINI_API_KEY is required"); process.exit(1); }

  const allNotes = await db.xhsNote.findMany({
    where: { status: "scheduled" },
    orderBy: { scheduledAt: "asc" },
  });

  const notes = allNotes.filter(n => NOTE_CONFIGS[n.title]);
  console.log(`🎨 生成 ${notes.length} 篇笔记配图（文字嵌入 prompt）\n`);

  for (const note of notes) {
    const cfg = NOTE_CONFIGS[note.title];
    const filepath = resolve(IMAGES_DIR, `${note.id}.png`);

    console.log(`📐 [${cfg.template}] "${note.title}"`);

    let buf: Buffer | null = null;

    try {
      if (cfg.template === "scene") {
        buf = await callGemini(buildScenePrompt(cfg, note.industry || "general"));
      } else if (cfg.template === "data") {
        buf = await callGemini(buildDataPrompt(cfg));
      } else if (cfg.template === "tool") {
        buf = await callGemini(buildToolPrompt(cfg, note.industry || "general"));
      } else if (cfg.template === "before_after") {
        buf = await callGemini(buildBeforeAfterPrompt(cfg, note.title));
      } else if (cfg.template === "text_card") {
        buf = await callGemini(buildTextCardPrompt(cfg));
      }

      if (buf) {
        writeFileSync(filepath, buf);
        console.log(`   ✅ 保存 (${(buf.length / 1024).toFixed(0)}KB)\n`);
      } else {
        console.log(`   ❌ 生成失败，跳过\n`);
      }
    } catch (err) {
      console.error(`   ❌ 出错:`, err);
    }

    // 限速
    await new Promise(r => setTimeout(r, 3000));
  }

  await db.$disconnect();
  console.log("🎉 全部完成！");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
