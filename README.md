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
    
<img width="1268" height="1421" alt="8d5eca273433c8b475019b61252da554" src="https://github.com/user-attachments/assets/6e630849-0735-488b-9443-d9dfbe56b5d9" />

<img width="876" height="640" alt="ae4e970f18e5ee5e0316e991e3fa0ae3" src="https://github.com/user-attachments/assets/107c26ab-51ff-43fb-b552-5f55c565df72" />


## API 使用

服务器默认运行在 `http://127.0.0.1:8889`。

*   **Base URL**: `http://127.0.0.1:8889/v1`
*   **Chat Completions**: `/chat/completions`
*   **Models**: `/models`

## 监控面板

访问 `http://127.0.0.1:8889/monitor` 查看实时监控数据。



<img width="2221" height="1385" alt="331e3515ddbb324def9c1e4a4c7baeb6" src="https://github.com/user-attachments/assets/ab4149f0-830f-40bc-b607-eccf49f4e1f5" />

<img width="2236" height="1321" alt="5883f858aa6bca4d9f21a3119cbae9bc" src="https://github.com/user-attachments/assets/34523dd4-68cb-4c61-9489-be5242aa9087" />

<img width="1828" height="776" alt="793104949f5163014e0a668a68ab5089" src="https://github.com/user-attachments/assets/a7fb2dc4-63f3-4685-8781-3be99c368ef7" />

<img width="2215" height="1372" alt="477bedbd9b7b0b96db7b54ef3edb8998" src="https://github.com/user-attachments/assets/e4da13b9-9e25-4875-b559-29444c535bcb" />

<img width="933" height="379" alt="70411e54a616988878aaddb7e2d005e1" src="https://github.com/user-attachments/assets/ee84243d-5979-44cb-9c83-85058fe5192c" />

<img width="1844" height="762" alt="68182086f1748390a07944c997ce03af" src="https://github.com/user-attachments/assets/7f7345cd-3edc-43ac-96e2-1607d3e77ccc" />

<img width="1957" height="1328" alt="6b2288c97ccf8e7fb489e0142b486540" src="https://github.com/user-attachments/assets/352b9cad-5967-446d-828a-1361236c84d4" />

<img width="1907" height="1309" alt="874ba3fad60abd011f953962d042bfa4" src="https://github.com/user-attachments/assets/efda8c07-29ba-4758-a032-90121603a1dd" />

<img width="1345" height="1246" alt="b1e18fd6268cd93bc90640f04d4fa1f0" src="https://github.com/user-attachments/assets/83d2fd72-3ff9-4d0a-a9ce-1de56087b0dc" />

<img width="1283" height="1219" alt="80ee21aa97371b04e42c8614879923b7" src="https://github.com/user-attachments/assets/e9d70a59-9254-4a73-a9cf-c8ef77b83599" />

<img width="1279" height="1195" alt="ae64e8bb82a293641465553a6a28f6d2" src="https://github.com/user-attachments/assets/28483969-73f1-4958-b9f1-483bd0afa3ae" />

<img width="1258" height="1189" alt="b258a45280d9e063a095a848e5a075b3" src="https://github.com/user-attachments/assets/19b0e19c-cc10-4d0d-9e99-6e29f6efbb04" />
   
<img width="1910" height="1321" alt="9d323242b4bde3dd620aa1409f9b69df" src="https://github.com/user-attachments/assets/efa926ce-8f4e-4950-abd1-9a9cd7e58d9c" />

<img width="2240" height="1267" alt="c4e100b7bbb750ca56ef766c02ef4b12" src="https://github.com/user-attachments/assets/ec3c1e0c-b307-4d6f-8964-38c0d5ea02c9" />

<img width="2227" height="1316" alt="36a6ec8526f594ded8bb25f776cb8bf4" src="https://github.com/user-attachments/assets/f0cba863-6d5e-4008-a418-d2a92b13a62b" />

<img width="2192" height="1310" alt="局部截取_20260120_034550" src="https://github.com/user-attachments/assets/a2a6246e-6e57-47a2-b63c-8af73a03e6e2" />

   
## 代理网页

<img width="754" height="1093" alt="局部截取_20260120_034140" src="https://github.com/user-attachments/assets/8044159c-afb5-4c54-9e29-0cd3d64202e7" />

   
<img width="664" height="1084" alt="局部截取_20260120_034251" src="https://github.com/user-attachments/assets/8c6367e3-fc2e-4030-beb5-9f30720d93d0" />

   
<img width="724" height="1081" alt="局部截取_20260120_034212" src="https://github.com/user-attachments/assets/072cd33b-f5d4-4b22-9c6b-aae417936335" />

   
<img width="683" height="1085" alt="局部截取_20260120_034234" src="https://github.com/user-attachments/assets/25a5f08b-26df-4ae1-af44-b6f178b76520" />


## 目录结构说明

<img width="1120" height="796" alt="局部截取_20260120_034507" src="https://github.com/user-attachments/assets/8d7246b6-d06f-4a16-939e-384f28e3f590" />

<img width="1210" height="451" alt="局部截取_20260120_034418" src="https://github.com/user-attachments/assets/658904bf-0796-4560-a6a7-9cbebd97321c" />

*   `dark-server.js`: 核心服务器代码。
*   `public/`: 静态资源文件（监控面板）。
*   `scripts/`: 辅助脚本。
*   `quota-config.json`: 配额配置文件。
*   `request_logs/`: 请求日志
*   `quota-state.json`: 配额状态

