#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v npm >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 或更新版本，然后重新运行此脚本。"
  exit 1
fi
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Mac 安装包必须在 macOS 上构建。"
  exit 1
fi
npm ci --include=dev
npm test
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac -- --publish never
echo "构建完成，DMG 和 ZIP 位于 release 文件夹。请在本机授权屏幕访问并测试。"
