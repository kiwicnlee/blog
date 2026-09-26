# kiwi的个人博客

使用 Hexo 搭建的中文个人博客。顶部为跳转栏，桌面左侧为站点目录，中间为文章内容，右侧为当前内容导航；窄屏可展开目录。当前部分文章和关于页内容是可替换的示例。

## 本地运行

项目已包含 `pnpm-lock.yaml`，建议使用 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm run server --ip 127.0.0.1
```

打开 `http://127.0.0.1:4000/blog/` 预览。如果 4000 端口被占用，可在命令末尾加 `--port 4300`。站点的正式地址在 `_config.yml` 中设为 `https://kiwicnlee.github.io/blog/`，所以本地预览也使用 `/blog/` 路径。生成静态站点：

```bash
pnpm run build
```

生成的文件位于 `public/`。

## 更新博客

- 站点名称、副标题、作者与站点地址：编辑 `_config.yml`。
- 首页主标题和简介：编辑 `themes/atelier/_config.yml`。
- 关于页：编辑 `source/about/index.md`。
- 文章：编辑或删除 `source/_posts/` 中的示例文章；新建文章运行 `pnpm exec hexo new "文章标题"`。
- 文章图片：新建文章后，将图片放进同名资源文件夹，在 Markdown 中使用 `![说明](图片名.jpg)`。例如 `source/_posts/my-note.md` 的图片放在 `source/_posts/my-note/`。
- 样式：编辑 `themes/atelier/source/css/style.css`。

## 发布到 GitHub Pages

在此工作目录中，使用 `pulish.sh` 发布源码，不依赖本地 `.git` 元数据，也不修改全局 Git 配置：

```bash
./pulish.sh --dry-run
./pulish.sh "更新博客文章"
```

脚本先比较远端 `kiwicnlee/blog` 的 `main` 分支，只上传有变化的源码，并在写入远端前运行 `pnpm run build`。需要删除远端已有、但本地已移除的文章或文件时，显式加 `--delete`。`pnpm run deploy` 也会调用此脚本。

认证优先使用环境变量 `GH_TOKEN` 或 `GITHUB_TOKEN`；未设置时，只读现有的 `~/.git-credentials`。令牌需要该仓库的 **Contents: write** 权限；修改工作流文件时还可能需要 **Workflows: write** 权限。脚本不会打印令牌或将其写入新文件。

仓库的 **Settings → Pages → Build and deployment → Source** 应设为 **GitHub Actions**。发布后，`.github/workflows/pages.yml` 会安装锁定的依赖、生成 `public/`，并部署到 `https://kiwicnlee.github.io/blog/`。

如果以后更换仓库路径或使用自定义域名，请同步修改 `_config.yml` 的 `url`，重新构建后检查首页和文章页的链接。

## 个人在线编辑

独立的 Cloudflare Worker 编辑后台位于 `editor/`，仅允许博客所有者通过 GitHub 登录，支持草稿 PR、富文本和思维导图编辑。后台地址为 `https://kiwi-blog-editor.kiwi-blog-editor.workers.dev/`；设置和维护步骤见 [editor/README.md](editor/README.md)。
