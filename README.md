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
    
![alt text](8d5eca273433c8b475019b61252da554.png) 

![alt text](ae4e970f18e5ee5e0316e991e3fa0ae3.png) 
## API 使用

服务器默认运行在 `http://127.0.0.1:8889`。

*   **Base URL**: `http://127.0.0.1:8889/v1`
*   **Chat Completions**: `/chat/completions`
*   **Models**: `/models`

## 监控面板

访问 `http://127.0.0.1:8889/monitor` 查看实时监控数据。

![alt text](331e3515ddbb324def9c1e4a4c7baeb6.png)

 ![alt text](5883f858aa6bca4d9f21a3119cbae9bc.png) 
 
 ![alt text](793104949f5163014e0a668a68ab5089.png) 
 
 ![alt text](477bedbd9b7b0b96db7b54ef3edb8998.png) 
 
 ![alt text](70411e54a616988878aaddb7e2d005e1.png) 
 
 ![alt text](68182086f1748390a07944c997ce03af.png) 
 
 ![alt text](6b2288c97ccf8e7fb489e0142b486540.png)
 
  ![alt text](874ba3fad60abd011f953962d042bfa4.png)
  
   ![alt text](b1e18fd6268cd93bc90640f04d4fa1f0.png) 
   
   ![alt text](80ee21aa97371b04e42c8614879923b7.png) 
   
   ![alt text](ae64e8bb82a293641465553a6a28f6d2.png)
   
   ![alt text](b258a45280d9e063a095a848e5a075b3.png) 
   
   ![alt text](9d323242b4bde3dd620aa1409f9b69df.png) 
   
   ![alt text](c4e100b7bbb750ca56ef766c02ef4b12.png) 
   
   ![alt text](36a6ec8526f594ded8bb25f776cb8bf4.png) 
   
## 代理网页

   ![alt text](局部截取_20260120_034550.png) 
   
   ![alt text](局部截取_20260120_034140.png) 
   
   ![alt text](局部截取_20260120_034251.png) 
   
   ![alt text](局部截取_20260120_034212.png) 
   
   ![alt text](局部截取_20260120_034234.png)

## 目录结构说明
![alt text](局部截取_20260120_034507.png) 
![alt text](局部截取_20260120_034418.png) 
*   `dark-server.js`: 核心服务器代码。
*   `public/`: 静态资源文件（监控面板）。
*   `scripts/`: 辅助脚本。
*   `quota-config.json`: 配额配置文件。
*   `request_logs/`: 请求日志
*   `quota-state.json`: 配额状态

