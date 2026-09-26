---
title: 从 Hexo 到 GitHub Pages：个人博客搭建与发布总结
date: 2026-09-26 16:21:00
description: 以机器人博客为例，梳理 Hexo 写作、项目站点路径配置、GitHub Actions 构建和 GitHub Pages 发布的完整流程。
categories:
  - 机器人技术
tags:
  - Hexo
  - GitHub Pages
  - 博客搭建
---

个人博客可以拆成两件事：用 **Hexo** 把 Markdown 文章生成静态网页，再用 **GitHub Pages** 托管生成的网站。本文以「机器人博客」为例，总结从本地写作到线上发布的关键步骤。

<!-- more -->

## 先看完整流程

```text
Markdown 文章与主题
       ↓ Hexo 构建
public/ 静态网页
       ↓ GitHub Actions 上传并部署
GitHub Pages 公开地址
```

日常维护时，提交的是文章、主题、配置和锁文件等**源码**。`public/` 是构建结果，由工作流重新生成，本站的 `.gitignore` 已将它排除。

## 准备 Hexo 项目

从零开始时，先安装 Node.js 和 Git，再按 [Hexo 官方安装与初始化文档](https://hexo.io/docs/)创建站点：

```bash
npm install -g hexo-cli
hexo init my-blog
cd my-blog
npm install
```

如果使用本站现成的项目，无须重新初始化。本站使用 Hexo 8、Node.js 22 和 pnpm，仓库中已经提交 `pnpm-lock.yaml`：

```bash
git clone https://github.com/kiwicnlee/blog.git
cd blog
pnpm install --frozen-lockfile
pnpm run server --ip 127.0.0.1
```

浏览器打开 `http://127.0.0.1:4000/blog/`。若 4000 端口被占用，可在启动命令后加 `--port 4300`，再访问对应端口。

## 配好站点地址与主题

Hexo 的根目录 `_config.yml` 管站点标题、网址、文章链接和主题；`themes/atelier/_config.yml` 管本站首页文案。本站仓库名为 `blog`，因此属于 GitHub Pages 的**项目站点**，网址带有 `/blog/` 子路径。关键配置是：

```yaml
title: 机器人博客
url: https://kiwicnlee.github.io/blog/
theme: atelier
```

Hexo 会根据 `url` 的路径确定站点根路径。检查生成网页时，CSS、JS、分类和文章链接应以 `/blog/` 开头。若把项目站点误配成 `https://kiwicnlee.github.io/`，页面可能加载出来，但资源或内页链接会指向错误的位置。相关规则见 [Hexo 配置文档](https://hexo.io/docs/configuration)和 [Hexo 的 GitHub Pages 指南](https://hexo.io/docs/github-pages)。

## 写文章、放图片、做本地构建

Hexo 将新文章放在 `source/_posts/`。可以用命令创建，也可以参照现有文章手动写 Markdown 文件；文章开头的 front matter 用于设置标题、日期、分类和标签。

```bash
pnpm exec hexo new "我的第一篇文章"
pnpm run build
```

本站开启了文章资源文件夹，可以把 `example.jpg` 放进与文章 Markdown 同名的文件夹，然后在正文中写 `![图片说明](example.jpg)`。`post_asset_folder: true` 和 `marked.postAsset: true` 使 Hexo 能把图片解析到文章对应的线上路径；具体语法见 [Hexo 资源文件夹文档](https://hexo.io/docs/asset-folders)。

本地构建成功后，静态文件位于 `public/`。发布前至少打开首页、一篇文章和分类页，检查图片与站内链接。

## 交给 GitHub Actions 发布

在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中，把 **Source** 设为 **GitHub Actions**。本站的 [.github/workflows/pages.yml](https://github.com/kiwicnlee/blog/blob/main/.github/workflows/pages.yml)会在 `main` 或 `master` 分支收到提交后执行：

1. 检出源码，安装 pnpm 和 Node.js 22。
2. 用 `pnpm install --frozen-lockfile` 安装锁定的依赖。
3. 用 `pnpm run build` 生成 `public/`。
4. 上传静态文件并部署到 GitHub Pages。

这是 [GitHub 官方支持的自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。本站通过 Actions 发布，**不需要**安装 `hexo-deployer-git`，也不用执行 `hexo deploy`。

以后更新文章，在正常的 Git 仓库中提交并推送到 `main` 即可。若不想修改全局 Git 作者配置，可以只在本次提交指定身份：

```bash
git add source/_posts/
git -c user.name="你的名字" -c user.email="你的邮箱" commit -m "Add blog post"
git push origin main
```

推送后到仓库的 **Actions** 页面检查构建和部署结果，再打开 `https://kiwicnlee.github.io/blog/` 验证线上内容。

## 遇到问题先检查哪里

| 现象 | 优先检查 |
| --- | --- |
| 本地端口已占用 | 启动时加 `--port 4300`，并用新端口访问 `/blog/`。 |
| 首页有内容，样式或内页打不开 | 检查 `_config.yml` 的 `url` 是否包含 `/blog/`，再检查生成的资源链接。 |
| 推送后网站没有更新 | 查看 Actions 运行结果，并确认 Pages 的 Source 选为 GitHub Actions。 |
| 文章图片不显示 | 检查图片是否在文章同名资源文件夹中，以及 Markdown 文件名是否一致。 |

把**源码、构建结果和线上页面**分开检查，通常就能定位问题：先确认文章写对了，再确认 Hexo 生成正确，最后确认 Pages 部署成功。
