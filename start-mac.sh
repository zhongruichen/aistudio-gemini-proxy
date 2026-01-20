#!/bin/bash

# =================================================================
# Gemini Proxy 一键启动脚本 (macOS)
# =================================================================

set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "   Gemini Proxy 启动脚本"
echo "=========================================="
echo

# --- 步骤 1: 检查 Node.js 环境 ---
echo -e "${YELLOW}[STEP 1]${NC} 检查 Node.js 环境..."

if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} 未找到 Node.js!"
    echo
    echo "请安装 Node.js，推荐方式："
    echo "  1. Homebrew: brew install node"
    echo "  2. 官网下载: https://nodejs.org/"
    echo "  3. nvm: nvm install --lts"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}[OK]${NC} Node.js 版本: $NODE_VERSION"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} 未找到 npm!"
    exit 1
fi

NPM_VERSION=$(npm -v)
echo -e "${GREEN}[OK]${NC} npm 版本: $NPM_VERSION"
echo

# --- 步骤 2: 检查并安装依赖 ---
echo -e "${YELLOW}[STEP 2]${NC} 检查项目依赖..."

NEED_INSTALL=0
DEPS=("express" "ws" "cors" "tiny-pinyin")

for dep in "${DEPS[@]}"; do
    if [ -d "node_modules/$dep" ]; then
        echo -e "  ${GREEN}[√]${NC} $dep 已安装"
    else
        echo -e "  ${RED}[×]${NC} $dep 未安装"
        NEED_INSTALL=1
    fi
done

if [ "$NEED_INSTALL" -eq 1 ]; then
    echo
    echo -e "${YELLOW}[INFO]${NC} 正在安装依赖..."
    npm install
    echo -e "${GREEN}[SUCCESS]${NC} 依赖安装完成!"
else
    echo -e "${GREEN}[OK]${NC} 所有依赖已存在"
fi
echo

# --- 步骤 3: 检查必要文件 ---
echo -e "${YELLOW}[STEP 3]${NC} 检查必要文件..."

if [ ! -f "dark-server.js" ]; then
    echo -e "${RED}[ERROR]${NC} 未找到 dark-server.js!"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} dark-server.js 存在"

if [ ! -f "proxy-config.txt" ]; then
    echo -e "${RED}[ERROR]${NC} 未找到 proxy-config.txt!"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} proxy-config.txt 存在"
echo

# --- 步骤 4: 启动服务器 ---
echo -e "${YELLOW}[STEP 4]${NC} 启动服务器..."

# 检查端口是否被占用
if lsof -i:8889 &> /dev/null; then
    echo -e "${YELLOW}[WARN]${NC} 端口 8889 已被占用，可能服务已在运行"
    read -p "是否终止现有进程并重启? (y/n): " choice
    if [ "$choice" = "y" ]; then
        lsof -ti:8889 | xargs kill -9 2>/dev/null || true
        lsof -ti:9998 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
fi

# 后台启动服务器
node dark-server.js &
SERVER_PID=$!
echo -e "${GREEN}[OK]${NC} 服务器已启动 (PID: $SERVER_PID)"

# 等待服务器启动
sleep 2

# 检查服务器是否成功启动
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${RED}[ERROR]${NC} 服务器启动失败!"
    exit 1
fi

echo

# --- 步骤 5: 打开浏览器 ---
echo -e "${YELLOW}[STEP 5]${NC} 打开浏览器..."

# 读取 proxy-config.txt 中的 URL
PROXY_URL=$(grep -v '^#' proxy-config.txt | head -1)

if [ -n "$PROXY_URL" ]; then
    echo -e "${GREEN}[INFO]${NC} 打开 AI Studio: $PROXY_URL"
    open "$PROXY_URL" 2>/dev/null || true
fi

sleep 1
echo -e "${GREEN}[INFO]${NC} 打开监控面板: http://127.0.0.1:8889/monitor"
open "http://127.0.0.1:8889/monitor" 2>/dev/null || true

echo
echo "=========================================="
echo -e "${GREEN}   项目已成功启动!${NC}"
echo "=========================================="
echo
echo "监控面板: http://127.0.0.1:8889/monitor"
echo "API 端点: http://127.0.0.1:8889"
echo "WebSocket: ws://127.0.0.1:9998"
echo
echo "按 Ctrl+C 停止服务器"
echo

# 前台等待，让用户可以看到日志并用 Ctrl+C 停止
wait $SERVER_PID
