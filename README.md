# 媒体图床（企业增强版）

该项目已从基础版升级为可用于生产环境的“企业增强版”，支持图片/视频上传、历史管理、预览、下载、删除、复制外链，并提供鉴权、筛选分页、健康检查和部署建议。

## 企业级增强点

- **安全增强**
  - 可选 API Key 鉴权（上传/删除接口保护）
  - 文件类型双重校验（MIME + 扩展名白名单）
  - 限制单文件大小与单次上传数量
- **稳定性增强**
  - 元数据原子写入（`tmp` + `rename`）
  - 写入串行队列，降低并发覆盖风险
  - 统一错误处理与 requestId 追踪
- **可运维增强**
  - `GET /healthz` 健康检查
  - 分页/搜索/类型过滤
  - 结构化 API 响应（`success/data/meta/error`）

---

## 环境变量

| 变量名 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `3000` | 服务端口 |
| `MEDIA_DIR` | `uploads` | 文件存储目录 |
| `DATA_DIR` | `data` | 元数据目录 |
| `MAX_FILE_SIZE_MB` | `512` | 单文件大小限制（MB） |
| `MAX_FILES_PER_UPLOAD` | `20` | 单次上传文件数量上限 |
| `REQUIRE_API_KEY` | `false` | 是否启用 API Key 鉴权 |
| `API_KEY` | 空 | API Key 内容 |

---

## 本地运行

```bash
npm install
npm start
```

访问：`http://127.0.0.1:3000`

---

## 宝塔面板生产部署（Node + PM2 + Nginx）

### 1) 安装软件

- Node.js 18+
- PM2（建议）
- Nginx

### 2) 上传项目

示例目录：`/www/wwwroot/media-host`

### 3) 配置环境变量并启动

```bash
cd /www/wwwroot/media-host
npm install
export PORT=3000
export REQUIRE_API_KEY=true
export API_KEY='your-strong-token'
export MAX_FILE_SIZE_MB=200
pm2 start server.js --name media-host
pm2 save
```

### 4) 配置反向代理

宝塔站点绑定域名后，在“反向代理”中将流量转发到：

- `http://127.0.0.1:3000`

### 5) 启用 HTTPS

宝塔 SSL 中签发 Let’s Encrypt 并启用强制 HTTPS。

### 6) 验证

- `GET /healthz` 应返回 `success=true`
- 上传/删除接口在开启鉴权时需携带 `x-api-key`

---

## API

- `GET /healthz`：健康检查
- `GET /api/files?page=1&pageSize=20&q=&type=all`：历史列表（分页/搜索/过滤）
- `POST /api/upload`：上传（表单字段名 `files`，可选 `x-api-key`）
- `DELETE /api/files/:id`：删除单个（可选 `x-api-key`）
- `DELETE /api/files`：清空全部（可选 `x-api-key`）
- `GET /api/files/:id/download`：下载
- `GET /media/<storageName>`：媒体访问

---

## 目录

- `server.js`：后端核心（API、校验、鉴权、错误处理）
- `index.html`：页面结构
- `app.js`：前端交互与 API 调用
- `styles.css`：样式
- `uploads/`：上传文件目录（自动创建）
- `data/files.json`：元数据文件（自动创建）

---

## 后续企业化建议

- 接入对象存储（S3/OSS/COS）与 CDN
- 接入数据库（MySQL/PostgreSQL）替代 JSON
- 接入 SSO / JWT / RBAC 权限模型
- 增加审计日志、告警、备份与生命周期策略
