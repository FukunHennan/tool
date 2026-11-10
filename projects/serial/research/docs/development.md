# 本地开发指南

## 1. 开发环境

- Node.js：推荐使用 `.nvmrc` 固定的 24.17.0；最低兼容版本见 `package.json#engines`。
- 包管理器：使用 `packageManager` 字段固定的 pnpm 11.16.0。
- 浏览器：最新版桌面 Chrome 或 Edge。
- 操作系统：优先验证 Windows，随后验证 macOS/Linux。

## 2. 可用命令

项目当前提供：

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm typecheck
pnpm test
pnpm test:watch
pnpm verify:esp-export
pnpm check
```

`pnpm check` 会依次执行类型检查、全部单元测试和生产构建。lint、组件测试和 E2E 仍属于后续门禁，尚未提供对应命令。命令名称是项目公共接口，修改时同步更新本页、README 和 CI。

## 3. 本地访问

Web Serial 可在 `localhost` 开发环境使用。真机调试必须由用户点击连接按钮触发端口选择器。自动化测试默认使用 `MockTransport`，不弹出真实系统端口选择窗口。

## 4. 推荐开发流程

1. 在 Mock 模式完成 UI 和协议逻辑。
2. 运行类型检查、单元测试和组件测试。
3. 使用协议测试向量验证解码器。
4. 在测试设备上执行真机检查清单。
5. 构建生产包并使用 `pnpm preview` 检查。
6. 推送分支并验证 EdgeOne 预览部署。

## 5. 编码约定

- TypeScript 开启严格模式。
- 领域层和协议层不依赖 React。
- 不使用 `any` 绕过串口类型问题；需要时补充清晰的类型声明。
- 所有可取消的循环必须有明确的取消和资源清理路径。
- 用户可见文案集中管理，错误对象保留机器可读错误码。
- 时间统一以 Unix 毫秒保存在内部，界面按本地时区格式化。

## 6. 提交前检查

- 类型检查通过。
- 单元和组件测试通过。
- 生产构建通过。
- 没有提交真实设备序列号、日志、账号或密钥。
- 行为或接口变化已同步更新技术文档。
