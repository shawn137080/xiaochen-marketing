@AGENTS.md

# 小红书选题工作台

这个仓库除了 Next.js 落地页（`src/`），主体是一个小红书运营工作台：
- `vault/`：Obsidian vault，所有数据都在这里（Markdown + frontmatter），用户通过 Obsidian Git 同步。
- `scripts/xhs/`：采集（Apify）、标准化、打分、写入 vault 的 CLI。入口 `npm run xhs -- help`，测试 `npm run test:xhs`。
- `.claude/skills/xhs-*`：AI 工作流（雷达、拆解、选题、写稿）。用户在 chat 里用自然语言触发。
- 账号定位、对标账号、关键词的唯一来源是 `vault/00-定位/账号定位.md`。
- 写 vault 时只改 frontmatter 数据字段和指定段落，不要覆盖用户写的内容。不要编造抓取数据。
