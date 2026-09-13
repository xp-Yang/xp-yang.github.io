# 拼豆狂欢作品接入

- 作品页：`/works/pindou/`
- 独立游戏：`/games/pindou/`，iPhone Safari 在此添加到主屏幕。
- 保留当前 9 关、体力、关卡解锁、触摸缩放、操作音效与本地存档。
- `content/local-projects.json` 保存入口，后续 Notion 同步不会覆盖。
- `public/games/pindou` 只含静态发布资源，不含录屏、开发工具、原始图片文件或用户存档。
- 首次完整加载并缓存后支持离线游玩。Service Worker 与 manifest 的相对路径限定在本游戏目录，不接管首页或 Inkloop。
- 存档位于浏览器本地；原来的 localhost 存档不会自动迁移到这个域名。

## 更新

在 `C:/Users/amd/Documents/ChatGPT/拼豆游戏` 运行 `npm run build:ios`。
从 `dist/ios-web/sw.js` 中的 FILES 清单复制资源，连同 `sw.js` 更新至本项目 `public/games/pindou`。清单外的历史导出文件无需发布。
网站运行 `npm test`、`npx tsc --noEmit`、`npm run build`；游戏运行 `npm test`、`node scripts/ios-web-check.mjs`。
提交并推送到 GitHub main 后，现有 Pages 工作流发布 `dist/client`。

## 验证范围

本次同步最新版九关、48 格初始暂存区（第一关保留教学容量）、最多 96 格扩容、紧凑布局与进度条。包含自动规划及动态播放模块，但测试模式继续仅在本地开放，公开网站和 Safari 正常版仍遵循关卡解锁规则。

离线缓存版本：`66a6c47c24118864`。旧页面关闭后新缓存生效，不清除游戏存档。

游戏 66 项测试及根路径、子路径的完整离线缓存检查通过；公开域名忽略本地测试开关的检查通过。网站测试、类型检查和静态输出检查在发布前执行。
当前浏览器连接不可用，未新增真实 Safari 或 iPhone 真机验证；不将离线运行时检查视为真机测试。
