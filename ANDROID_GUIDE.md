# Android 手机使用指南

本指南将详细介绍如何在 Android 手机上使用 Gemini Proxy。您可以根据需求选择以下两种方式：

1.  **作为客户端**：服务运行在电脑上，手机连接电脑使用。
2.  **作为服务器**：直接在手机上运行服务（通过 Termux），实现完全独立的移动端部署。

---

## 方案一：手机作为客户端（连接电脑）

**适用场景**：您已经在电脑（Windows/Mac/Linux）上启动了 `gemini-proxy` 服务，希望在手机上通过浏览器查看监控，或使用 AI 聊天软件连接该服务。

### 1. 电脑端准备
1.  确保电脑和手机连接在**同一个 Wi-Fi** 网络下。
2.  在电脑上启动服务：运行 `直接启动服务器.bat` 或在终端输入 `npm start`。
3.  **获取电脑的局域网 IP 地址**：
    *   **Windows**: 按 `Win + R`，输入 `cmd` 回车，在黑框中输入 `ipconfig`，找到 **IPv4 地址**（通常以 `192.168.` 开头，例如 `192.168.1.5`）。
    *   **Mac/Linux**: 打开终端，输入 `ifconfig` 或 `ip a` 查看。

### 2. 手机端访问监控面板
1.  打开手机浏览器（推荐 Chrome 或 Edge）。
2.  在地址栏输入：`http://<电脑IP>:8889/monitor`
    *   例如：`http://192.168.1.5:8889/monitor`
3.  **添加到主屏幕（可选）**：
    *   在浏览器菜单中点击“添加到主屏幕”，这样可以像 App 一样全屏运行监控面板。

### 3. 手机端配置 AI 软件（如 Chatbox, NextChat）
如果您想在手机上使用 AI 聊天软件连接此代理，请按以下方式配置：

*   **API Host / 代理地址**：`http://<电脑IP>:8889`
    *   注意：部分软件可能需要填写完整路径 `http://<电脑IP>:8889/v1/chat/completions`

---

## 方案二：手机作为服务器（使用 Termux）

**适用场景**：您希望随时随地使用该服务，无需依赖电脑。我们将使用 **Termux**（Android 上的 Linux 终端模拟器）来运行 Node.js 环境。

### 1. 安装 Termux
*   **推荐下载地址**：[F-Droid (Termux)](https://f-droid.org/packages/com.termux/)

### 2. 配置环境
打开 Termux，依次输入以下命令（每行输入后按回车，遇到询问输入 `y` 确认）：

```bash
# 1. 更新软件包列表
pkg update && pkg upgrade

# 2. 安装 Node.js (LTS版本) 和 Git
pkg install nodejs git
```

### 3. 获取项目代码
您有两种方式将代码放入手机：

#### 方式 A：使用 Git 克隆（推荐，方便更新）
```bash
git clone https://github.com/zhongruichen/aistudio-gemini-proxy.git
cd aistudio-gemini-proxy-v4.0-Preview
```

#### 方式 B：从电脑复制
1.  将电脑上的项目文件夹复制到手机存储的 `Download` 目录。
2.  在 Termux 中授予存储权限：
    ```bash
    termux-setup-storage
    ```
    *(手机会弹窗请求权限，请点击“允许”)*
3.  进入目录：
    ```bash
    cd storage/downloads/aistudio-gemini-proxy-v4.0-Preview
    ```

### 4. 安装依赖并启动

#### 方式 A：使用一键启动脚本（推荐）
我们为您准备了一个自动脚本，可以自动检测环境、安装依赖并启动服务。

在项目目录下执行：
```bash
# 赋予脚本执行权限（仅需执行一次）
chmod +x termux-start.sh

# 运行脚本
./termux-start.sh
```

#### 方式 B：手动执行
如果您喜欢手动操作，可以在项目目录下依次执行：

```bash
# 安装项目依赖
npm install

# 启动服务
node dark-server.js
```

看到类似 `HTTP服务器启动: http://0.0.0.0:8889` 的提示即表示启动成功。

### 5. 手机端使用
*   **本机访问**：打开手机浏览器访问 `http://127.0.0.1:8889/monitor`
*   **本机 AI 软件配置**：API 地址填写 `http://127.0.0.1:8889`

### 6. 保持后台运行
Android 系统很容易杀掉后台进程。为了让服务稳定运行：
1.  在 Termux 通知栏中，点击 "Acquire wakelock"（获取唤醒锁）。
2.  或者在 Termux 终端输入命令：`termux-wake-lock`。
3.  在手机设置中，将 Termux 的“电池优化”设置为“无限制”或“允许后台高耗电”。

---

## 常见问题排查

### Q1: 手机无法连接电脑上的服务？
*   **检查防火墙**：Windows 防火墙可能会拦截 8889 端口。请尝试临时关闭防火墙，或在防火墙设置中允许 Node.js 访问网络。
*   **检查网络**：确保手机和电脑连接的是同一个路由器/Wi-Fi。部分公共 Wi-Fi（如学校、公司）可能会隔离设备间通信。

### Q2: Termux 中 `npm install` 失败？
*   可能是网络问题。可以尝试切换 npm 镜像源：
    ```bash
    npm config set registry https://registry.npmmirror.com
    ```

### Q3: 如何停止服务？
*   在运行服务的终端窗口，按 `Ctrl + C` 即可停止。
