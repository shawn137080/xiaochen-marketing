/**
 * 本地测试图片生成（不需要数据库）
 * 用法：GEMINI_API_KEY=xxx [LLM_API_KEY=xxx] npx tsx src/test-gen-images.ts
 *
 * 从 NOTE_CONFIGS 选几张代表性模板生成图片，保存到 /tmp/xhs-test-images/
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const OUT_DIR = process.env.OUT_DIR || "/tmp/xhs-test-images";

const USE_LLM = process.env.USE_LLM === "true";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://aiberm.com/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "google/gemini-3-flash";

type Template = "scene" | "data" | "tool" | "before_after" | "text_card";

interface NoteImageConfig {
  template: Template;
  hookText: string;
  subText?: string;
  bigNumber?: string;
  bigLabel?: string;
  dataSub1?: string;
  dataSub2?: string;
  listItems?: [string, string, string];
}

// 每种模板选1个代表性样本测试
const TEST_CASES: Array<{ title: string; industry: string; cfg: NoteImageConfig }> = [
  {
    title: "空调季来了，暖通师傅你接得过来吗",
    industry: "HVAC暖通",
    cfg: {
      template: "scene",
      hookText: "空调季到了\n你接得过来吗",
      subText: "旺季每漏一个，损失的不只是一单",
    },
  },
  {
    title: "装修老板实测90天：接电话真实数据",
    industry: "装修",
    cfg: {
      template: "data",
      hookText: "实测90天\n成单数据来了",
      bigNumber: "+133%",
      bigLabel: "成单数提升",
      dataSub1: "三个月，收入明显多了",
    },
  },
  {
    title: "美甲店零漏单的秘密：就这一个设置",
    industry: "美甲",
    cfg: {
      template: "tool",
      hookText: "美甲店零漏单\n就这1步设置",
      subText: "5分钟搞定，客人说「你们好专业」",
      listItems: ["开启自动接听，电话不再漏", "自动发确认消息给客人", "老板专心做项目，不分心"],
    },
  },
  {
    title: "AI时代，用了和没用的差距",
    industry: "通用",
    cfg: {
      template: "before_after",
      hookText: "用了和没用\n差距已经出来了",
    },
  },
  {
    title: "来加拿大创业2年，我最后悔的一件事",
    industry: "创业故事",
    cfg: {
      template: "text_card",
      hookText: "来加拿大创业 2 年\n最后悔的一件事",
      subText: "不是选错行业，不是定价太低\n是没早点用自动接听",
    },
  },
];

function loadSkillGuide(): string {
  const skillPath = resolve(__dirname, "../skills/xhs-image-prompts/SKILL.md");
  try {
    return readFileSync(skillPath, "utf-8");
  } catch {
    return "";
  }
}

async function generatePromptWithLLM(
  title: string,
  industry: string,
  cfg: NoteImageConfig,
  skillGuide: string,
): Promise<string | null> {
  if (!LLM_API_KEY || !skillGuide) return null;

  const [hookLine1, hookLine2 = ""] = cfg.hookText.split("\n");

  const systemPrompt = `You are a Xiaohongshu (Chinese social media) viral image designer for 兜兜AI, serving Chinese-Canadian small business owners.
Write a Gemini image generation prompt IN ENGLISH. The image must contain specific Chinese text elements listed below.

Design style guide (for reference):
---
${skillGuide}
---

HARD RULES (never violate):
1. The prompt must be written IN ENGLISH
2. The Chinese text elements must appear VERBATIM in the image as specified in the user message
3. Brand name in the image must be exactly: 兜兜AI
4. Art style: Clean modern TYPOGRAPHY-FIRST graphic design poster — bold text as the hero element, simple geometric shapes or emoji as accents. NO cartoon characters, NO stick figures, NO illustrated people, NO LINE Friends style, NO webtoon style, NO cute characters
5. Output ONLY the prompt text, no explanations or prefixes`;

  const userPrompt = `Write an English Gemini image prompt for this Xiaohongshu post:

Note title: ${title}
Industry: ${industry}
Template type: ${cfg.template}

REQUIRED Chinese text in the image (copy exactly):
- Large headline text, bold coral red (#FF5C5C), two lines:
  Line 1: 「${hookLine1}」
  Line 2: 「${hookLine2}」
- Small brand text: 兜兜AI (dark gray, small, at bottom center)
${cfg.subText ? `- Supporting subtitle text: 「${cfg.subText}」` : ""}
${cfg.bigNumber ? `- Giant number in center: 「${cfg.bigNumber}」\n- Label below number: 「${cfg.bigLabel ?? ""}」` : ""}
${cfg.dataSub1 ? `- Supporting stats text: 「${cfg.dataSub1}」 ${cfg.dataSub2 ? `「${cfg.dataSub2}」` : ""}` : ""}

Aspect ratio: ${cfg.template === "scene" || cfg.template === "before_after" ? "3:4" : "9:16"}
Style: Clean graphic design poster, typography-first. NO cartoon characters, NO stick figures, NO illustrations.`;

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error("LLM error:", err);
    return null;
  }
}

// 内置 fallback prompt，不依赖 LLM
function buildFallbackPrompt(cfg: NoteImageConfig): string {
  const [h1, h2 = ""] = cfg.hookText.split("\n");

  switch (cfg.template) {
    case "data":
      return `Clean data poster for Chinese social media, 9:16 portrait format. Dark near-black background #1a1a2e.

TOP-LEFT area: Two lines of white bold Chinese headline text:
Line 1: "${h1}"
Line 2: "${h2}"

CENTER of image: Giant coral red #FF5C5C bold number "${cfg.bigNumber ?? ""}" — enormous, taking up 30% of the image height.

BELOW THE NUMBER: White medium Chinese text "${cfg.bigLabel ?? ""}"

BELOW THAT: Smaller light gray Chinese text "${cfg.dataSub1 ?? ""}"

DECORATIVE: One thin horizontal coral red line above the giant number. Three small coral red circular dots in corners.

VERY BOTTOM CENTER: Tiny gray text "兜兜AI"

Style: Minimal dark-mode data poster, bold clean typography, NO cartoon characters, NO illustrations, NO watermarks, professional graphic design.`;

    case "tool": {
      const items = cfg.listItems ?? ["自动接听，24小时不漏单", "即时回复，客户秒感受到", "轻松管理，老板不分心"];
      return `Clean informational card for Chinese social media, 9:16 portrait format. Soft cream white background #FFF9F0.

TOP of image: A bold coral red stripe (full width, ~8% height) at very top.

UPPER CENTER: Large bold coral red #FF5C5C Chinese headline text:
"${h1}"
"${h2}"
Below headline: smaller dark gray Chinese text "${cfg.subText ?? ""}"

MIDDLE: A clean white rounded rectangle card with subtle drop shadow. Inside the card, exactly three list items with coral red circle number bullets, in dark gray Chinese text:
① ${items[0]}
② ${items[1]}
③ ${items[2]}

VERY BOTTOM CENTER: Tiny dark gray text "兜兜AI"

Style: Clean graphic design card, professional, NO cartoon characters, NO illustrations, NO watermarks. Modern Chinese brand style.`;
    }

    case "before_after":
      return `Clean split-panel comparison poster for Chinese social media, 3:4 portrait format.

TOP HALF (~45%): Dark gray #2d2d2d background. Small white label "❌ 以前" top-left. Large white Chinese text describing the bad scenario: "电话漏接，客户流失"

DIVIDING STRIPE (~10%): Bold coral red horizontal band. White bold Chinese headline centered: "${h1} ${h2}"

BOTTOM HALF (~45%): Warm cream #FFF9F0 background. Small coral red label "✅ 现在" left side. Large dark gray Chinese text describing the improvement: "每个电话都有人接，订单稳稳的"

VERY BOTTOM CENTER: Tiny dark gray text "兜兜AI"

Style: Bold graphic design split layout, clean typography, NO cartoon characters, NO illustrations, NO watermarks.`;

    case "text_card": {
      const bodyText = cfg.subText ?? "生意做好，从接好每个电话开始";
      return `Minimalist quote card for Chinese social media, 9:16 portrait format. Warm cream white background #FFF9F0 with very subtle paper texture.

TOP-LEFT: Very large decorative quotation mark " in coral red #FF5C5C, positioned prominently.

UPPER CENTER: Very large bold dark gray #1a1a1a Chinese text: "${h1}"
Below it in coral red bold: "${h2}"

A thin coral red horizontal line separator below the headline.

CENTER: Medium dark gray Chinese body text, centered, displayed as a single text block (do NOT repeat any line):
"${bodyText}"

BOTTOM: Small rounded coral red badge with white text "兜兜AI" centered inside.

Style: Clean typography-only design, warm and editorial, NO cartoon characters, NO illustrations, NO watermarks. Each text element appears exactly once.`;
    }

    case "scene":
    default:
      return `Clean modern Chinese social media poster, 3:4 portrait format. Warm cream white background #FFF9F0.

TOP-LEFT area: Two lines of large bold Chinese headline text, coral red #FF5C5C, thick font weight:
Line 1: "${h1}"
Line 2: "${h2}"

CENTER of image: One large simple emoji relevant to the industry — displayed very large (about 150px), no outline, just clean emoji. Choose from: 📱🔧✂️🌿❄️🏠 based on context.

BOTTOM area: A coral red full-width horizontal band containing small white Chinese text "${cfg.subText ?? ""}" centered inside it.

VERY BOTTOM CENTER: Tiny dark gray text "兜兜AI"

Style: Clean graphic design poster, typography-first, NO cartoon characters, NO illustrations, NO complex backgrounds, NO watermarks. Bold clean fonts. Minimal and professional.`;
  }
}

interface GeminiResponse {
  candidates?: Array<{ content: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
  error?: { message: string };
}

async function callGemini(prompt: string, aspectRatio: "3:4" | "9:16"): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio },
      },
    }),
  });
  const data = (await res.json()) as GeminiResponse;
  if (data.error) { console.error(`Gemini error: ${data.error.message}`); return null; }
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

function getAspectRatio(template: Template): "3:4" | "9:16" {
  return template === "scene" || template === "before_after" ? "3:4" : "9:16";
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error("❌ 需要设置 GEMINI_API_KEY 环境变量");
    console.error("   用法: GEMINI_API_KEY=xxx npx tsx src/test-gen-images.ts");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const skillGuide = loadSkillGuide();
  const useSkill = USE_LLM && !!skillGuide && !!LLM_API_KEY;

  console.log(useSkill
    ? `🧠 技能模式：LLM(${LLM_MODEL}) → Gemini 生图\n`
    : `⚡ 直接模式：硬编码模板 prompt → Gemini 生图（更稳定）\n`
  );
  console.log(`📁 输出目录：${OUT_DIR}\n`);

  for (const { title, industry, cfg } of TEST_CASES) {
    const ratio = getAspectRatio(cfg.template);
    console.log(`📐 [${cfg.template}/${ratio}] "${title}"`);

    let prompt: string;
    if (useSkill) {
      const llmPrompt = await generatePromptWithLLM(title, industry, cfg, skillGuide);
      if (llmPrompt) {
        prompt = llmPrompt;
        console.log(`   🧠 LLM prompt (${prompt.length} chars): ${prompt.slice(0, 100)}...`);
      } else {
        console.log(`   ⚠️  LLM 未返回，用内置 fallback`);
        prompt = buildFallbackPrompt(cfg);
      }
    } else {
      prompt = buildFallbackPrompt(cfg);
      console.log(`   📝 内置 prompt (${prompt.length} chars)`);
    }

    const slug = title.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "-");
    const filepath = resolve(OUT_DIR, `${cfg.template}-${slug}.png`);

    try {
      const buf = await callGemini(prompt, ratio);
      if (buf) {
        writeFileSync(filepath, buf);
        console.log(`   ✅ 保存: ${filepath} (${(buf.length / 1024).toFixed(0)}KB)\n`);
      } else {
        console.log(`   ❌ Gemini 未返回图片\n`);
      }
    } catch (err) {
      console.error(`   ❌ 出错:`, err);
    }

    if (TEST_CASES.indexOf({ title, industry, cfg } as typeof TEST_CASES[0]) < TEST_CASES.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n🎉 完成！图片保存在 ${OUT_DIR}`);
  console.log("   用 'open " + OUT_DIR + "' 在 Finder 查看");
}

main().catch(e => { console.error(e); process.exit(1); });
