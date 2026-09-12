# 圈个小世界作品接入

- 作品页：`/works/inkloop/`
- 独立游戏：`/games/inkloop/`（iPhone Safari 在此添加到主屏幕）
- 游戏版本：0.16.0，规则 inkloop-14。
- `content/local-projects.json` 保存本地作品，和 Notion 快照合并；后续同步 Notion 不会覆盖游戏入口。
- `public/games/inkloop` 仅包含发布的前端资源，不含对局日志、服务端数据或凭据。
- 游戏保留本地计分、全部 AI 策略、测试模式和日志；静态托管不提供好友挑战和匿名数据上传，入口已隐藏。
- 离线缓存和主屏幕入口仅作用于 `/games/inkloop/`，不接管网站首页。新缓存等待旧游戏页面关闭后启用。

## 更新游戏

在游戏项目 `C:/Users/amd/Documents/ChatGPT/paper.io` 运行 `npm run export:portfolio`。
把 `artifacts/portfolio-game` 内容同步到本项目的 `public/games/inkloop`，删除被新版替代的旧哈希资源；勿复制整个游戏工作区。
运行 `npm test`、`npx tsc --noEmit`、`npm run build`，通过后提交并推送到 GitHub 的 main 分支。现有 Pages 工作流发布 `dist/client`。

## 本轮验证

- 网站 15 项测试及网站、游戏和 Cocos 类型检查通过。
- 游戏离线相关 5 项测试通过，包含子目录缓存不会拦截首页和其他游戏。
- WebKit 桌面 1440×1000、iPhone 模拟 390×844：作品列表进入、直接刷新、内嵌开局、暂停、独立打开、主屏幕 scope 和断网重载开局通过；无脚本异常、无 API 请求。
- iPhone 视口模拟不等于真机，实际设备性能与主屏幕安装仍需真机确认。
