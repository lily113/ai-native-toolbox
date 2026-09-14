# 02 · Friend Journal — AI 朋友型电子手账

> 情绪需要一个出口，但写日记的门槛太高：不知道写什么，也坚持不下来。
> 解法是让 AI 先听你说，再替你把这一天变成一页好看的手账。

**👥 三人小组项目**（AI 编码课程作业）｜ 我负责：前端页面与组件、AI 提示词设计、演示流程
详细归属见 [../CONTRIBUTIONS.md](../CONTRIBUTIONS.md)

---

## 产品逻辑

```
用户倾诉 → AI 理解情绪 → 自动生成手账内容 → 智能排版 → 周/月情感总结 → 可选分享
```

**核心价值主张**：把手账的"记录成本"降到零，只保留"仪式感"和"情绪疗愈"。用户只需要说话，剩下的交给 AI。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 状态管理 | Redux Toolkit（chat / journal / user 三个 slice） |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | PostgreSQL（schema + migration） |
| 缓存 | Redis |
| AI | OpenAI API（情绪理解 + 内容生成 + 排版生成） |

```
02-friend-journal/
├── frontend/src/
│   ├── pages/         HomePage / ChatPage / JournalPage / SummaryPage / SettingsPage
│   ├── components/    Chat/ Journal/ Summary/ Layout/
│   ├── services/      api / chatService / journalService / summaryService / shareService
│   ├── stores/slices/ chatSlice / journalSlice / userSlice
│   └── utils/         journalRenderer.ts
├── backend/src/
│   ├── routes/        chatRoutes / journalRoutes / summaryRoutes / shareRoutes
│   ├── services/      openaiService / shareService
│   ├── models/        User / Chat / Journal / Summary
│   └── db/            schema.sql + migrations
└── docs/              AI_PROMPTS.md / DEMO_GUIDE.md
```

---

## 我负责的部分里，最难的一件事

**让 AI 的输出稳定地符合审美预期。**

生成手账不是"生成一段文字"。它要求模型同时控制：
- **内容**：这一天发生了什么、情绪是什么、用什么语气
- **结构**：标题、正文、心情标签、配图描述之间的层次关系
- **视觉**：色彩倾向、装饰元素、排版密度

模型很擅长第一项，但**在第二、三项上极不稳定**——同一个输入，两次生成的排版可能完全不是一回事。

我的做法是**把开放式的"生成一页手账"拆成结构化的输出契约**：先约束模型输出一个固定 schema 的 JSON（标题/情绪标签/正文分段/视觉主题），再由前端 `journalRenderer.ts` 负责渲染。

**这样模型只负责它擅长的事（理解和表达），不可控的部分（排版）交给代码。** 输出稳定性的问题，本质上不是提示词问题，是**职责划分**问题。

> 这和我后来在求职工作流里得到的体会是同一件事：**不要让模型做它不稳定的事，把不稳定的部分用结构框住。**

---

## 项目文档

- [`docs/AI_PROMPTS.md`](./docs/AI_PROMPTS.md) — 核心 AI 提示词设计
- [`docs/DEMO_GUIDE.md`](./docs/DEMO_GUIDE.md) — 演示流程（含本地启动方式）

---

## 备注：关于简历里的描述

早期原型阶段我用 Manus 驱动原型设计、Gemini 生成 HTML 展示页；后来迭代成 React + Node 的完整应用。**两个阶段都是真的**，但如果只说前者，会让人误以为这个项目只是"用 AI 生成了一个网页"。这里把完整过程写清楚。
