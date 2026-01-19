@echo off
chcp 65001 > nul
title 1 - Node.js Environment Installer

echo.
echo ======================================================
echo           1. Node.js 环境自动安装脚本
echo ======================================================
echo.
echo  此脚本将检查并安装 Node.js。如果您的电脑上已经安装过，它会自动跳过。
echo.

:: --- 检查管理员权限 ---
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 未获得管理员权限！请右键点击此脚本，然后选择 "以管理员身份运行"。
    goto end_pause
)

:: --- 检查 Node.js 是否已存在 ---
where node > nul 2>&1
if %errorlevel% equ 0 (
    echo [信息] 系统检测到 Node.js 已安装。无需重复操作。请直接运行第二个脚本: "Node.js 环境定位与检测脚本.bat"
    goto end_pause
)

echo [步骤] 未找到 Node.js，准备开始自动安装...
echo.

:: --- 下载并安装 ---
set "NODE_INSTALLER_URL=https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi"
set "NODE_INSTALLER_NAME=node_installer.msi"

echo [步骤] 正在下载 Node.js 安装包...
powershell -Command "(New-Object Net.WebClient).DownloadFile('%NODE_INSTALLER_URL%', '%NODE_INSTALLER_NAME%')"

if not exist "%NODE_INSTALLER_NAME%" (
    echo [严重错误] Node.js 安装包下载失败！请检查网络连接。
    goto end_pause
)

echo [步骤] 下载完成，正在进行静默安装... (此过程没有界面)
msiexec /i "%NODE_INSTALLER_NAME%" /qn

del "%NODE_INSTALLER_NAME%"

echo.
echo ======================================================
echo           Node.js 已成功安装！
echo ======================================================
echo.
echo [下一步]
echo 请关闭此窗口，然后双击运行第二个脚本:"Node.js 环境定位与检测脚本.bat"
echo.

:end_pause
echo 按任意键退出...
pause > nul