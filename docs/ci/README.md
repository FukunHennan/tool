# CI 定义（待启用）

这个文件就是 `.github/workflows/tests.yml` 的内容，但目前**放在 `docs/ci/` 而没生效**。

## 为什么没生效

推送凭证是 OAuth App token，缺少 `workflow` scope，GitHub 拒绝写入 `.github/workflows/`：

```
refusing to allow an OAuth App to create or update workflow
`.github/workflows/tests.yml` without `workflow` scope
```

## 怎么启用（二选一）

**方式一：网页上传（最快）**

GitHub 仓库页 → Add file → Create new file → 文件名填 `.github/workflows/tests.yml` → 把本文件内容粘进去 → Commit。网页会话权限完整，不受 token scope 限制。

**方式二：给凭证补 scope**

```powershell
gh auth refresh -s workflow      # 会打开浏览器授权
# 或换一个有 workflow scope 的 PAT：
git remote set-url origin https://<TOKEN>@github.com/FukunHennan/tool.git
```

补好之后本地执行：

```powershell
git mv docs/ci/tests.yml .github/workflows/tests.yml
git commit -m "Enable CI workflow"
git push
```

## 启用后能挡住什么

- 三个工具任一测试失败 → PR 变红
- pcb-cabinet 构建失败 → PR 变红
- 三套命令与 `CONTRIBUTING.md` 里要求本地执行的完全一致，本地能跑通就等于 CI 能过（已用干净克隆验证过一次）。
