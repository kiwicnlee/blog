# 机器人博客

使用 Hexo 搭建的中文个人博客，包含首页、文章、分类、归档和关于页面。当前文章和关于页内容是可替换的示例。首页提供「机器人与技术」「生活与随笔」两条阅读路线；文章页有目录导航。

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

1. 将此项目推送到 GitHub 仓库 `kiwicnlee/blog` 的 `main` 或 `master` 分支。
2. 在仓库的 **Settings → Pages → Build and deployment** 中，将 **Source** 设为 **GitHub Actions**。
3. 推送后，`.github/workflows/pages.yml` 会安装锁定的依赖、生成 `public/`，并部署到 `https://kiwicnlee.github.io/blog/`。也可以在 **Actions** 页面手动运行该工作流。

如果以后更换仓库路径或使用自定义域名，请同步修改 `_config.yml` 的 `url`，重新构建后检查首页和文章页的链接。
