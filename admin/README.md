# 私人核对管理台

管理台页面是公开仓库中的无数据壳，作品队列、草稿和操作历史只通过 Pages Functions 读取。发布前必须在 Cloudflare Access 中为 /admin/* 和 /api/admin/* 建立同一条登录策略；接口还会校验 Cf-Access-Authenticated-User-Email 是否在 ADMIN_EMAILS 中。

## Pages 绑定

在 Cloudflare Pages 项目中添加一个 D1 绑定，变量名为 DB，并执行 functions/schema.sql。生产环境设置以下变量或 Secret：

- ADMIN_EMAILS：允许进入管理台的邮箱，多个邮箱用逗号分隔。
- ADMIN_SESSION_SECRET：仅用于本地密码登录会话签名的随机 Secret。
- ADMIN_PASSWORD：可选；生产环境建议留空，使用 Cloudflare Access。
- REVIEW_SYNC_TOKEN：GitHub Actions 向管理台同步队列的 Bearer Secret。
- GITHUB_OWNER、GITHUB_REPO、GITHUB_BRANCH：私有工具仓库位置。
- GITHUB_REVIEW_TOKEN：只授予该私有仓库 Contents: Read and write、Actions: Read and write 的 Fine-grained token。

GitHub 私有工具仓库还需要设置 REVIEW_SYNC_URL 和 REVIEW_SYNC_TOKEN Secrets。REVIEW_SYNC_URL 是当前 Pages 域名下的 /api/admin/sync-queue，例如 https://example.pages.dev/api/admin/sync-queue。

## 使用方式

打开 /admin/ 后，在“待确认、抽查候选、风险提示、已处理”之间切换。选择后会自动保存草稿；勾选若干条并点“确认选中”，最后点“发布已确认”。发布接口只写回私有仓库的 config/manual_overrides.csv，随后触发现有月度工作流，公开网页仍由原有审计链路生成。
