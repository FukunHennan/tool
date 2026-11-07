# 一起出发 · 出游地图

前后端分离的本地应用：原生 HTML/CSS/JavaScript 前端通过 JSON API 访问 Python 后端，SQLite 持久化地点与集合设置。后端同时提供静态文件，无需跨域配置。Python 3.10+，无第三方依赖。

## 启动

```powershell
python server.py
```

访问 http://127.0.0.1:8765/ 。继续使用原来的浏览器及这个完整地址。不要再用 `python -m http.server`，它不提供 API。端口被占用时先关闭旧静态服务器。可使用 `--port 8766`，但新端口无法读取原端口的浏览器配置。

## 数据与迁移

- 数据库：`data/travel.sqlite3`（Git 忽略），环境变量 `TRAVEL_DB` 可指定其他文件。
- 首次连接空数据库，自动导入原浏览器地点及集合安排，保留浏览器恢复副本 `travel-recovery-before-server`。
- 数据库已有记录时，以后端记录为准。其他浏览器的旧行程可先导出，再导入显式替换。
- 地图 Key 和 securityJsCode 继续保存在当前浏览器，不上传本应用后端、不提交 Git。新浏览器需要配置地图。
- 顶部显示保存状态。失败时保留浏览器副本并提示重试；版本冲突不覆盖他人修改，请先导出当前行程再刷新。
- 定期导出行程，并在停止服务后备份数据库文件；导出不包含地图凭证。

## 架构

```text
dist/             前端页面、地图交互、路线展示
  storage.js      API、迁移、保存队列、冲突提示
server.py         HTTP API、输入校验、SQLite、静态文件服务
data/             数据库（不提交）
tests/            集成测试
```

| 接口 | 说明 |
| --- | --- |
| GET /api/health | 后端健康检查 |
| GET /api/state | 获取行程和 revision |
| PUT /api/state | 以 `{revision, state}` 保存完整行程；冲突返回 409 |

state 包含 points、city、meeting。地图、搜索和路线仍通过前端调用高德 JS API。出发时间按当前查询耗时估算，不预测未来路况。

## 验证

```powershell
python -m unittest discover -s tests -v
node --check dist/storage.js
```

## 范围

本机单份行程，无账号、互联网登录或多人实时推送。只监听 127.0.0.1，连接同一后端的页面共用一份数据库。新版前端需要后端，不支持仅静态托管。远程仓库尚未配置。
