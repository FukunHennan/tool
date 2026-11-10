# EdgeOne Makers 部署指南

## 1. 部署模型

第一阶段是静态 SPA：

```text
GitHub main 分支
  -> 安装依赖
  -> Vite 生产构建
  -> dist/
  -> EdgeOne Makers
  -> HTTPS 站点
```

串口通信不经过 EdgeOne，因此部署过程不需要串口驱动或设备权限。

## 2. 预期构建配置

前端项目初始化后使用：

| 项目 | 值 |
| --- | --- |
| 框架 | Vite |
| 安装命令 | `pnpm install --frozen-lockfile` |
| 构建命令 | `pnpm build` |
| 输出目录 | `dist` |
| 生产分支 | `main` |

Node.js 和 pnpm 具体版本会在初始化代码时固定，不依赖平台浮动默认值。

## 3. 首次部署

1. 在 EdgeOne Makers 控制台新建项目。
2. 授权并选择 GitHub 仓库 `FukunHennan/PC-Toolbox`。
3. 选择 `main` 分支。
4. 填写构建命令和输出目录。
5. 启动部署并检查构建日志。
6. 使用平台 HTTPS 域名打开页面。
7. 检查 `window.isSecureContext` 和 `navigator.serial`。
8. 由用户点击连接按钮完成真机测试。

## 4. SPA 路由

如果后续使用客户端路由，服务器需要将未知页面路径回退到 `/index.html`。第一版可采用单页面或 Hash Router，降低首次部署配置复杂度；路由方案确定后在配置文件中固化。

## 5. GitHub Actions 备选方案

优先使用 EdgeOne 的 Git 仓库自动部署。如果需要在发布前执行自定义门禁，可以改为 GitHub Actions，在测试和构建成功后通过 EdgeOne CLI 部署。令牌只能存放在 GitHub Actions Secrets 中，不能提交到仓库。

官方流程参考：[Use GitHub Actions](https://pages.edgeone.ai/document/use-github-actions)。

## 6. 环境与密钥

第一阶段没有后端密钥。任何未来加入的公开前端环境变量都会被打包进浏览器资源，不能存放数据库密码、API 私钥或设备主密钥。

## 7. 验证与回滚

每次生产部署后检查：

- 首页和静态资源返回成功。
- HTTPS 证书有效。
- Web Serial 能力检测符合预期。
- Mock 模式可完成收发。
- 指定测试电脑可以打开系统串口选择器。

发生严重问题时，在 EdgeOne 控制台回滚到上一成功部署，或回退 Git 提交后重新构建。回滚只影响 Web 应用版本，不修改用户电脑上的设备和本地日志。

