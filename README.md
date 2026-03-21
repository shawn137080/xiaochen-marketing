# 小陈 Marketing Skills

小陈（AllDayAnswer 小红书运营 AI）的技能库和工具集。

## 结构

```
xiaochen-marketing/
└── skills/
    └── xhs-image-prompts/   # 小红书爆款图 prompt 库（1145+ 案例）
        ├── SKILL.md          # 选图决策框架
        ├── cards.md          # 信息卡片 / 知识卡 / 手绘风
        ├── portraits.md      # 九宫格 / 四宫格 / 人像
        ├── products.md       # 商品摄影
        ├── brand.md          # 品牌创意 / IP 设计
        ├── scenes.md         # 生活场景 / 氛围图
        └── illustrations.md  # 插画 / 3D / Pixar 风格
```

## 如何使用

skills 目录通过 symlink 挂载到 `~/.claude/skills/`，Claude Code 自动加载。

```bash
# 安装到本机
git clone https://github.com/shawn137080/xiaochen-marketing.git ~/xiaochen-marketing
ln -sf ~/xiaochen-marketing/skills/xhs-image-prompts ~/.claude/skills/xhs-image-prompts
```

## 来源

prompt 库整理自 [songguoxs/gpt4o-image-prompts](https://github.com/songguoxs/gpt4o-image-prompts)。
