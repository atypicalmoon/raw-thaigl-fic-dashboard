# 私人核对管理台

管理台页面是公开仓库中的无数据壳，CP 冲突队列、草稿和处理结果只通过 Pages Functions 读取。发布前必须在 Cloudflare Access 中为 /admin/* 和 /api/admin/* 建立同一条登录策略；接口还会校验 Cf-Access-Authenticated-User-Email 是否在 ADMIN_EMAILS 中。

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

管理台只处理系统无法自动判断的多 CP 冲突；日期缺失、标签风险和普通重复记录不进入人工队列。

打开 /admin/ 后，在“待处理”和“处理结果”之间切换。选择最终决定会自动保存为“未提交修改”，仍留在待处理；勾选后点“提交所选”即可写回私有仓库的 config/manual_overrides.csv 并触发现有月度工作流。提交后先显示“已提交”，下一轮队列同步确认冲突消失后才显示“已生效”。公开网页仍由原有审计链路生成。
