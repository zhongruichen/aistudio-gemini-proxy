# Gemini AI Studio Proxy Server

这是一个高性能的 Gemini AI Studio 反向代理服务器，旨在提供稳定、快速的 Gemini API 访问服务。

## 功能特点

*   **高性能连接池**：内置 WebSocket 连接池，支持多路复用和自动重连。
*   **智能路由**：根据模型配额和连接状态智能分发请求。
*   **OpenAI 兼容**：提供兼容 OpenAI 格式的 API 接口，可直接接入大多数现有客户端。
*   **实时监控**：内置 Web 监控面板，实时查看请求统计、连接状态和日志。
*   **伪流式支持**：支持将非流式响应转换为流式响应，提升用户体验。
*   **多模态支持**：完整支持文本、图片等多模态输入输出。

## 快速开始

### 1. 环境准备

本项目依赖 Node.js 环境。如果您尚未安装，请运行以下脚本自动安装：

*   双击运行 `1.检测安装node.js环境（管理权限运行）.bat`

### 2. 配置

*   `proxy-config.txt`：已预设好共享的 AI Studio 链接，通常无需修改。

### 3. 启动

*   双击运行 `3.快速启动-内置安装依赖.bat`
    *   该脚本会自动检查依赖、安装缺失模块并启动服务器。
    *   启动后会自动打开监控面板和 AI Studio 网页。

## API 使用

服务器默认运行在 `http://127.0.0.1:8889`。

*   **Base URL**: `http://127.0.0.1:8889/v1`
*   **Chat Completions**: `/chat/completions`
*   **Models**: `/models`

## 监控面板

访问 `http://127.0.0.1:8889/monitor` 查看实时监控数据。

## 目录结构说明

*   `dark-server.js`: 核心服务器代码。
*   `public/`: 静态资源文件（监控面板）。
*   `scripts/`: 辅助脚本。
*   `quota-config.json`: 配额配置文件。
*   `request_logs/`: 请求日志（运行时生成，不应提交）。
*   `quota-state.json`: 配额状态（运行时生成，不应提交）。

## 注意事项

*   请勿将 `quota-state.json` 或 `request_logs/` 目录上传到公共仓库。
*   本项目已包含 `.gitignore` 配置，会自动忽略上述文件。
