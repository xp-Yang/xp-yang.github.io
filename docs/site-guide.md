# 事件视界 · 站点维护说明

一个中文个人站，用于展示 Web 游戏、Shader 实验、博客、文学写作和学习笔记。首页的黑洞由 WebGL 实时渲染；内容通过 Notion 手动同步为本地快照，线上访问不依赖 Notion。

## GitHub Pages

正式地址为 https://xp-yang.github.io/ 。推送到 `main` 后，GitHub Actions 会构建并发布 `dist/client` 中的静态文件。仓库设置中的 Pages 发布源应设为 GitHub Actions。

`npm run build` 会输出各页面的目录入口、RSS 与站点地图，支持直接访问和刷新作品详情页。页面间使用普通链接，作品缩略图仍保留展开动画。Notion Token 只用于手动同步，不需要提供给 Pages。

## 本地运行

```bash
npm install
npm run dev
```

姓名、简介、联系方式与正式站点地址集中在 `site.config.ts`。示例内容位于 `content/content.json`，每条都带有“示例内容”标记。

## Notion 内容库

建立一个 Notion 数据库（当前 API 中对应 Data Source），并为集成授予读取权限。字段名与类型如下：

| 字段 | Notion 类型 | 说明 |
| --- | --- | --- |
| Title | Title | 必填 |
| Slug | Text | 必填，小写字母、数字与连字符 |
| Type | Select | Project / Blog / Literature / Note |
| Status | Status 或 Select | 只有 Published 会同步 |
| PublishedAt | Date | 必填 |
| Summary | Text | 可选，缺省时取正文首段 |
| Tags | Multi-select | 通用标签 |
| Cover | Files | 会下载到站点本地 |
| Featured | Checkbox | 首页精选 |
| Order | Number | 越小越靠前 |
| DemoURL | URL | 项目可选，必须为 HTTPS |
| DemoMode | Select | Embed / Link，缺省为 Link |
| SourceURL | URL | 项目源码地址 |
| Tech | Multi-select | 项目技术栈 |

复制 `.env.example` 为 `.env.local`，填写集成 Token 与 Data Source ID，然后执行：

```bash
npm run content:sync
```

同步器先完成字段、URL 和重复 Slug 校验，再替换 `content/content.json`；同步失败时会保留上一份有效快照。更新流程为：在 Notion 发布 → 手动同步 → 构建并部署。
