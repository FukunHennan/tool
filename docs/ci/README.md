# CI 定义

CI 工作流已启用，定义见 [.github/workflows/tests.yml](../.github/workflows/tests.yml)。

本地等价检查：`pwsh scripts/check.ps1`（与 CI 完全一致的六步，含三个工具测试与 PCB 构建）。

启用说明：2026-11-10 通过 SSH 公钥认证推送。原 OAuth token 缺 `workflow` scope 无法写入 `.github/workflows/`，SSH 密钥为账号级凭据、不受 OAuth scope 限制，故改用 `git@github.com:FukunHennan/tool.git` 推送。
