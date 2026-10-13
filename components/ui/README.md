# 通用前端模块

业务组件统一从 `@/components/ui` 引用控件和图标。模块沿用现有 React、Base UI 和 Tailwind，不新增依赖。

## Review 入口

| 文件                     | 职责                                                     |
| ------------------------ | -------------------------------------------------------- |
| `index.ts`               | 当前业务使用的公共 API，基础控件继续保留独立子入口       |
| `icons.ts`               | 图标库适配层；只有这里直接引用 Lucide                    |
| `styles.css`             | 样式入口，在应用根样式中导入一次                         |
| `tokens.css`             | 语义颜色、字体栈、Outfit 字体注册和圆角；映射到 Tailwind |
| `foundations.css`        | 署名字体、文学字体、眉题和玻璃表面                       |
| `parameter-controls.tsx` | 带数值读数的滑杆、带说明的开关                           |
| `native-controls.tsx`    | 原生按钮、文件/复选输入、原生滑杆；保留原生事件与 ref    |
| `native-controls.css`    | 原生控件的焦点、禁用状态和跨浏览器滑杆样式               |
| `technical-theme.css`    | 可选的密集工具界面配色，保留 GCode 原有色值              |

## 使用约定

```tsx
import { Button, Play, NumericControl } from '@/components/ui';

<Button aria-label="播放" variant="ghost" size="icon">
  <Play aria-hidden="true" />
</Button>

<NumericControl
  label="曝光"
  displayValue={exposure.toFixed(2)}
  value={exposure}
  min={0.25}
  max={1.5}
  step={0.01}
  onChange={setExposure}
/>
```

普通按钮用 `Button`；需要完全保留自定义布局和原生行为时用 `ActionButton`。它默认 `type="button"`，表单提交需要显式指定 `submit`。文件选择和原生复选框用 `NativeInput`；原生滑杆用 `RangeInput`，范围、步长和事件由业务传入。

交互控件由调用方提供可见标签或 `aria-label`。禁用、键盘焦点和 ref 透传由通用控件负责；按钮中的纯装饰图标可传入 `aria-hidden`。

样式入口：

```css
@import '../components/ui/styles.css';
```

字体使用 `font-sans`、`font-mono`、`font-literary`。首页署名使用 `site-signature`，保留 Outfit Medium 和原有字距。颜色使用 `bg-background`、`text-foreground`、`text-text-muted`、`text-accent-soft`、`bg-surface-panel` 等语义类；CSS 中使用相应 `var(--...)`。新增通用颜色先在 `tokens.css` 定义，再增加 Tailwind 映射。

工具界面可在根容器加 `data-ui-theme="technical"`，使用 `--technical-*` 配色，并继承原生控件的焦点与滑杆皮肤。该皮肤只在容器内生效。

独立 Vite 入口也导入同一个 `styles.css`，并启用 `@tailwindcss/postcss`。样式入口通过 `@source '.'` 显式扫描通用模块，保证外部应用能生成滑杆、按钮等控件的工具类。

## 模块边界与迁移

- 模块不引用业务组件、物理参数、文章数据、路由或作品模型。
- 模块入口没有整体添加 `use client`，交互组件自行声明边界；内部使用子入口以避免循环依赖。
- 首页、导航、内容卡片、文章正文、作品合集、Shader 和黑洞页面已使用统一图标与语义颜色；黑洞参数面板使用通用参数控件。重力实验通过 `demos/gravity-lab/src/work-controls.tsx` 适配原有 DOM 事件，调用同一套滑杆、开关、选择器和输入框。
- GCode 页面使用通用原生控件及工具主题，保留文件导入、取消、层范围、逐步走线和可见性逻辑。
- `components/work-parameter-controls.tsx` 保留旧路径转导出，兼容工作区已有调用；新调用使用公共入口。
- 已打包的游戏 iframe 内部资源，以及 Shader/场景/走线分类的业务颜色不归通用 UI 管理。它们的宿主页仍调用通用模块。
- `app/globals.css` 保留站点布局、交互策略、滚动行为和作品缩略图效果，字体和通用色值由本模块提供。

## 本次审阅重点

先查看颜色与字体定义，再查看原生控件的事件/ref 兼容性，最后查看黑洞和 GCode 的接入差异。GCode 的界面字体已统一到站点字体栈；业务布局仍保留在页面样式中。

浏览器项目的类型配置移除全局 Cloudflare Workers 类型，避免其 `Element.append/remove` 与浏览器 DOM 同名冲突；本地 Cloudflare 开发插件继续通过自己的导入获得类型。类型检查排除 `public` 和独立实验构建产物，实验源代码仍参加类型检查。

## 验证记录

- 主站 44 项测试通过；项目类型检查、通用模块和重力 UI 接入文件的代码检查通过。
- 完整静态构建通过，53 项入口资源验证通过。
- 浏览器验证：首页 Outfit 字体与配色、播放/暂停，GCode 示例加载、窄屏面板展开和收起、结束层滑杆的键盘调整（144 → 143）。
- 重力实验验证：共享滑杆键盘调整密度（1.00 → 1.05）同步更新单球质量（0.382 → 0.401）；轨迹开关切换成功。已修复独立入口缺少 Tailwind 编译的问题，以及滑杆本体的可访问标签。
- 全量代码检查仍有存量问题；与当前提交对比，主站文件未新增检查报错。
- 独立重力实验的物理测试目前 12/15 通过，失败项为初始分布不重叠、求力误差断言、密度更新校验；本次未修改物理实现。
