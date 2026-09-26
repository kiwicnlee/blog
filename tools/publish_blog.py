#!/usr/bin/env python3
"""Publish this Hexo source tree without changing any Git configuration."""

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "kiwicnlee/blog"
BRANCH = "main"
API_BASE = "/repos/" + REPOSITORY
MANAGED_DIRS = (".github", "scaffolds", "source", "themes", "tools")
ROOT_FILES = {
    ".gitignore",
    "README.md",
    "_config.landscape.yml",
    "_config.yml",
    "package.json",
    "pnpm-lock.yaml",
    "pulish.sh",
}
SKIP_DIRS = {".agents", ".codex", ".git", "__pycache__", "node_modules", "public"}
SKIP_FILES = {".DS_Store", "Thumbs.db", "db.json"}
MAX_FILE_SIZE = 20 * 1024 * 1024


def fail(message):
    raise RuntimeError(message)


def token_from_environment_or_store():
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(name):
            return os.environ[name]

    credentials = Path.home() / ".git-credentials"
    if credentials.is_file():
        for line in credentials.read_text(encoding="utf-8").splitlines():
            parsed = urlsplit(line)
            if parsed.hostname == "github.com" and parsed.password:
                return unquote(parsed.password)
    fail("缺少 GitHub 凭据：请设置 GH_TOKEN，或使用已有的 ~/.git-credentials。")


class GitHub:
    def __init__(self, token=None):
        self.token = token

    def request(self, method, path, payload=None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_path = path
        if method == "GET":
            request_path += ("&" if "?" in request_path else "?") + "fresh=" + str(time.time_ns())
        body_file = None
        if data is not None:
            with tempfile.NamedTemporaryFile(prefix="robot-blog-body-", delete=False) as temporary:
                temporary.write(data)
                body_file = temporary.name

        try:
            config = (
                'url = "https://api.github.com{}"\n'
                'request = "{}"\n'
                'header = "Accept: application/vnd.github+json"\n'
                'header = "Cache-Control: no-cache"\n'
                'header = "Content-Type: application/json"\n'
                'header = "User-Agent: kiwicnlee-blog-publisher"\n'
                'header = "X-GitHub-Api-Version: 2022-11-28"\n'
            ).format(request_path, method)
            if self.token:
                config += 'header = "Authorization: Bearer {}"\n'.format(self.token)
            if body_file:
                config += 'data-binary = "@{}"\n'.format(body_file)

            attempts = 3 if method == "GET" else 1
            for attempt in range(attempts):
                result = subprocess.run(
                    ["curl", "--silent", "--show-error", "--max-time", "20", "--config", "-",
                     "--write-out", "\n__STATUS__:%{http_code}\n"],
                    input=config.encode("utf-8"), capture_output=True, timeout=25,
                )
                body, separator, status_text = result.stdout.rpartition(b"\n__STATUS__:")
                status = int(status_text.strip()) if separator and status_text.strip().isdigit() else 0
                if result.returncode == 0 and 200 <= status < 300:
                    return json.loads(body)
                if method == "GET" and attempt + 1 < attempts and (status == 0 or status in (429, 500, 502, 503, 504)):
                    time.sleep(attempt + 1)
                    continue
                if status >= 400:
                    try:
                        detail = json.loads(body).get("message", "")
                    except (UnicodeDecodeError, ValueError):
                        detail = ""
                    fail("GitHub API {} {} 失败：HTTP {} {}".format(method, path, status, detail))
                fail("GitHub API 连接失败：curl 退出码 {}，HTTP {}".format(result.returncode, status))
        finally:
            if body_file:
                Path(body_file).unlink(missing_ok=True)


def managed_path(path):
    return path in ROOT_FILES or any(path.startswith(folder + "/") for folder in MANAGED_DIRS)


def skip_path(path):
    parts = Path(path).parts
    return any(part in SKIP_DIRS or part.startswith(".deploy") for part in parts) or (
        parts[-1] in SKIP_FILES or parts[-1].endswith((".log", ".pyc"))
    )


def git_blob_sha(content):
    return hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()


def local_files():
    files = {}
    candidates = [ROOT / name for name in ROOT_FILES]
    for folder in MANAGED_DIRS:
        base = ROOT / folder
        if base.is_dir():
            candidates.extend(base.rglob("*"))

    for path in candidates:
        relative = path.relative_to(ROOT).as_posix()
        if skip_path(relative):
            continue
        if path.is_symlink():
            fail("拒绝发布符号链接：" + relative)
        if not path.is_file():
            continue
        if path.name == ".env" or path.name.startswith(".env."):
            fail("拒绝发布环境变量文件：" + relative)
        if path.stat().st_size > MAX_FILE_SIZE:
            fail("文件超过 20 MiB，请单独处理：" + relative)
        content = path.read_bytes()
        mode = "100755" if path.stat().st_mode & 0o111 else "100644"
        files[relative] = (git_blob_sha(content), mode, content)
    return files


def remote_files(github, tree_sha):
    tree = github.request("GET", API_BASE + "/git/trees/" + tree_sha + "?recursive=1")
    if tree.get("truncated"):
        fail("远端文件树被 GitHub 截断，已停止发布。")
    return {item["path"]: (item["sha"], item["mode"])
            for item in tree["tree"] if item["type"] == "blob"}


def publish(args):
    files = local_files()
    public = GitHub()
    head = public.request("GET", API_BASE + "/commits/" + BRANCH)
    old_tree = head["commit"]["tree"]["sha"]
    remote = remote_files(public, old_tree)
    changed = sorted(path for path, item in files.items()
                     if remote.get(path) != item[:2])
    remote_only = sorted(path for path in remote if managed_path(path) and path not in files)
    deleted = remote_only if args.delete else []

    print("目标：{}/{}  当前提交：{}".format(REPOSITORY, BRANCH, head["sha"][:12]))
    print("新增或修改：{} 个，删除：{} 个".format(len(changed), len(deleted)))
    for path in changed:
        print("  + " + path)
    for path in deleted:
        print("  - " + path)
    if remote_only and not args.delete:
        print("远端另有 {} 个受管理文件未在本地找到，已保留；如需删除请加 --delete。".format(len(remote_only)))
    if not changed and not deleted:
        print("没有需要发布的变化。")
        return
    if args.dry_run:
        print("预览完成，远端未修改。")
        return

    print("正在验证 Hexo 构建……", flush=True)
    subprocess.run(["pnpm", "run", "build"], cwd=ROOT, check=True)
    github = GitHub(token_from_environment_or_store())
    account = github.request("GET", "/user")
    if account["login"] != "kiwicnlee":
        fail("当前凭据属于 {}，预期为 kiwicnlee，已停止发布。".format(account["login"]))

    changes = []
    for path in changed:
        expected, mode, content = files[path]
        blob = github.request("POST", API_BASE + "/git/blobs", {
            "content": base64.b64encode(content).decode("ascii"),
            "encoding": "base64",
        })
        if blob["sha"] != expected:
            fail("GitHub 返回的文件哈希不一致：" + path)
        changes.append({"path": path, "mode": mode, "type": "blob", "sha": expected})
    for path in deleted:
        changes.append({"path": path, "mode": remote[path][1], "type": "blob", "sha": None})

    tree = github.request("POST", API_BASE + "/git/trees", {
        "base_tree": old_tree,
        "tree": changes,
    })
    result_tree = remote_files(public, tree["sha"])
    for path in changed:
        if result_tree.get(path) != files[path][:2]:
            fail("发布前文件树校验失败：" + path)
    for path in deleted:
        if path in result_tree:
            fail("发布前删除校验失败：" + path)

    message = args.message or "Update blog " + datetime.now().strftime("%Y-%m-%d %H:%M")
    commit = github.request("POST", API_BASE + "/git/commits", {
        "message": message,
        "tree": tree["sha"],
        "parents": [head["sha"]],
    })
    updated = github.request("PATCH", API_BASE + "/git/refs/heads/" + BRANCH, {
        "sha": commit["sha"],
        "force": False,
    })
    if updated["object"]["sha"] != commit["sha"]:
        fail("远端分支回读与新提交不一致，请检查 GitHub。")
    print("发布成功：https://github.com/{}/commit/{}".format(REPOSITORY, commit["sha"]))
    print("Pages 构建：https://github.com/{}/actions".format(REPOSITORY))


def main():
    parser = argparse.ArgumentParser(description="将机器人博客源码发布到 GitHub main，不修改本机 Git 配置。")
    parser.add_argument("message", nargs="?", help="提交说明，默认使用当前时间")
    parser.add_argument("--dry-run", action="store_true", help="只预览变更，不构建或发布")
    parser.add_argument("--delete", action="store_true", help="删除远端受管理目录中本地已不存在的文件")
    args = parser.parse_args()
    try:
        publish(args)
    except (RuntimeError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print("发布失败：{}".format(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
