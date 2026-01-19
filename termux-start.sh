#!/bin/bash

echo "=== Gemini Proxy Termux 一键启动脚本 ==="

# 1. 检查并安装 Node.js
if ! command -v node &> /dev/null; then
    echo "[*] 未检测到 Node.js，正在尝试安装..."
    pkg update -y
    pkg install nodejs -y
    if ! command -v node &> /dev/null; then
        echo "[!] Node.js 安装失败，请手动执行 pkg install nodejs"
        exit 1
    fi
else
    echo "[*] Node.js 已安装: $(node -v)"
fi

# 2. 检查并安装依赖
if [ ! -d "node_modules" ]; then
    echo "[*] 未检测到依赖包，正在运行 npm install..."
    # 配置 npm 镜像源以加速下载
    npm config set registry https://registry.npmmirror.com
    npm install
    if [ $? -ne 0 ]; then
        echo "[!] 依赖安装失败，请检查网络"
        exit 1
    fi
else
    echo "[*] 依赖包已存在，跳过安装"
fi

# 3. 启动服务
echo "---------------------------------------"
echo "[*] 正在启动服务..."
echo "[*] 监控面板: http://127.0.0.1:8889/monitor"
echo "[*] API 地址: http://127.0.0.1:8889"
echo "[*] 按 Ctrl + C 停止服务"
echo "---------------------------------------"

# 申请唤醒锁防止后台被杀（如果安装了 termux-api）
if command -v termux-wake-lock &> /dev/null; then
    termux-wake-lock
    echo "[*] 已申请后台唤醒锁"
fi

node dark-server.js
