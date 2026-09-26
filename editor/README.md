# Kiwi 协作写作后台

这是与公开 Hexo 博客分开的 Cloudflare Worker。作者在 Worker 域名通过 GitHub OAuth App 登录，写 Markdown/富文本、图片和思维导图；Worker 用仅授权 `kiwicnlee/blog` 的私有 GitHub App 创建 `cms/...` 草稿分支及 PR。只有 PR 合并到 `main` 后，现有 Pages 工作流才会更新公开博客。受邀作者不需要仓库写权限。

## 当前能力与边界

- 新建文章、编辑仍开放的草稿 PR；表单填写标题、摘要、分类、标签、日期，Vditor 提供 Markdown 分屏和可视化编辑。
- 上传 PNG、JPEG、WebP 图片，单张最多 5 MiB、一次保存总计最多 6 MiB；附件与文章一起提交到文章资源文件夹。
- Mind Elixir 拖拽编辑树状思维导图；保存 `mindmap.json` 和由服务端安全生成的 `mindmap.svg`。正文的 `<!-- mindmap -->` 会替换成图片，未写该标记时自动附在文末。
- 本版只新建文章和编辑开放草稿；已发布文章仍通过 GitHub PR 修改。编辑器预览是 Markdown 预览，完整 Hexo 页面由合并后构建验证。
- 后台静态文件可以公开访问，但所有文章与草稿接口都要求 GitHub 登录、受邀用户 ID、有效会话及写入请求的来源/CSRF 校验。
- Worker 对登录按来源 IP、对已登录接口按 GitHub 数字用户 ID 限流；阈值在 `wrangler.jsonc` 中配置。

## 本地验证

```bash
cd editor
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm exec wrangler deploy --dry-run
```

`pnpm run dev` 只启动静态编辑界面，真实登录与保存需要 Worker 和 GitHub App。不要把真实凭据写入仓库、`wrangler.jsonc` 或 Vite 的 `VITE_*` 变量。

## 部署准备

1. 使用 Cloudflare Workers 账号部署 `editor/`，获得 `https://kiwi-blog-editor.<workers-subdomain>.workers.dev`。Worker 域名提供编辑页与 API，两者同源。公开博客仍由 GitHub Pages 托管。
2. 在 GitHub 注册 **OAuth App**，回调地址设为 `https://<Worker 域名>/auth/callback`，关闭回调 URL 通配符匹配。它只用于识别作者；后台不请求仓库写入 scope。记录 OAuth Client ID 和 Client Secret。
3. 另注册一个仅限所有者安装的**私有 GitHub App**，仓库权限为 **Contents: Read and write** 与 **Pull requests: Read and write**，仅安装到 `kiwicnlee/blog`。它只作为编辑服务创建草稿，不作为受邀作者的登录入口。记录 App ID、Installation ID，并生成私钥。
4. 在 Worker Secrets 中配置下表的值。GitHub App 私钥支持原始 PEM 文本（含 `BEGIN RSA PRIVATE KEY` 或 `BEGIN PRIVATE KEY`）。
5. 在 GitHub 为 `main` 设置必须通过 PR、由所有者审核的分支规则，且不要让 GitHub App 绕过该规则。Worker 不提供直接合并接口。
6. 用受邀作者的真实账号完成登录、新建草稿、编辑和 PR 审核验证，再在博客主题配置中填写 `admin_url`，显示「写作后台」入口。

| Worker Secret | 用途 |
| --- | --- |
| `GITHUB_APP_ID` | GitHub App 数字 ID |
| `GITHUB_OAUTH_CLIENT_ID` | 作者登录专用 OAuth App Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth 授权码交换，绝不下发到浏览器 |
| `GITHUB_INSTALLATION_ID` | 安装在本站仓库上的 Installation ID |
| `GITHUB_PRIVATE_KEY` | GitHub App 私钥 PEM |
| `SESSION_SECRET` | 至少 32 字符的随机会话签名密钥 |
| `ALLOWED_GITHUB_IDS` | 逗号分隔的受邀作者数字用户 ID，包括所有者 |
| `EDITOR_ORIGIN` | Worker 编辑站完整来源，例如 `https://kiwi-blog-editor.<subdomain>.workers.dev`，不带末尾斜线 |

例如，查询 `kiwicnlee` 的 GitHub 数字 ID：

```bash
curl -sS https://api.github.com/users/kiwicnlee | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'
```

对每位作者重复查询后，使用 `pnpm exec wrangler secret put <名称>` 逐项配置 Secret。`GITHUB_PRIVATE_KEY` 可通过标准输入传入私钥文件，避免复制到命令参数：

```bash
pnpm exec wrangler secret put GITHUB_PRIVATE_KEY < /path/outside/repo/github-app.pem
```

其余 Secret 可由 Wrangler 的交互提示录入。部署命令：

```bash
pnpm run deploy
```

## 发布流程

作者在后台保存时，Worker 校验输入，生成文章与资源文件，提交到 `cms/<作者>/<文章>-<随机值>` 分支并创建 PR。再次保存会更新原草稿分支。你在 GitHub 审核 Markdown、图片和思维导图，合并到 `main` 后触发 `.github/workflows/pages.yml`。移除作者时，从 `ALLOWED_GITHUB_IDS` 删除其数字 ID；已有会话会在下一次请求时失效。
