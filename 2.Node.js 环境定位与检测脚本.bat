@echo off
chcp 65001 > nul
title 2 - Node.js 环境定位与检测脚本 (增强版)

echo.
echo ======================================================
echo           2. Node.js 环境定位与检测脚本
echo ======================================================
echo.
echo  此脚本将查找并保存 node.exe 和 npm.cmd 的完整路径...
echo.

:: 强制设置工作目录
cd /d "%~dp0"
echo [DEBUG] 当前工作目录: %cd%
echo.

set "NODE_DIR="
set "NODE_EXE_PATH="
set "NPM_CMD_PATH="

:: --- 查找 node.exe 的完整路径 ---
echo [步骤] 正在查找 Node.js...

:: 方法1: 使用where命令
for /f "delims=" %%i in ('where node 2^>nul') do (
    set "NODE_EXE_PATH=%%i"
    echo [DEBUG] 通过where找到: %%i
    goto found_node
)

:: 方法2: 如果where失败，尝试直接调用
if not defined NODE_EXE_PATH (
    echo [DEBUG] where命令未找到，尝试直接调用...
    for /f "delims=" %%i in ('node -e "console.log(process.execPath)" 2^>nul') do (
        set "NODE_EXE_PATH=%%i"
        echo [DEBUG] 通过直接调用找到: %%i
        goto found_node
    )
)

:found_node
if not defined NODE_EXE_PATH (
    echo [错误] 未能找到 Node.js 的安装路径！
    echo.
    echo 可能的原因：
    echo 1. Node.js 未安装 2. Node.js 未添加到系统PATH
    echo.
    echo 请确认您已成功运行: "1安装node.js环境（管理权限运行）.bat"
    echo.
    goto end_pause
)

for %%F in ("%NODE_EXE_PATH%") do set "NODE_DIR=%%~dpF"

if "%NODE_DIR:~-1%"=="\" set "NODE_DIR=%NODE_DIR:~0,-1%"

set "NPM_CMD_PATH=%NODE_DIR%\npm.cmd"

if not exist "%NPM_CMD_PATH%" (
    echo [DEBUG] 默认位置未找到 npm.cmd，尝试搜索...
    for /f "delims=" %%i in ('where npm 2^>nul') do (
        set "NPM_CMD_PATH=%%i"
        echo [DEBUG] 通过where找到npm: %%i
        goto found_npm
    )
)
:found_npm

echo.
echo [验证] 检查文件是否存在...
if exist "%NODE_EXE_PATH%" (
    echo   [√] node.exe 文件存在
) else (
    echo   [×] node.exe 文件不存在！
    goto end_pause
)

if exist "%NPM_CMD_PATH%" (
    echo   [√] npm.cmd 文件存在
) else (
    echo   [×] npm.cmd 文件不存在！
    echo   [DEBUG] 尝试寻找 npm.bat...
    set "NPM_CMD_PATH=%NODE_DIR%\npm.bat"
    if exist "!NPM_CMD_PATH!" (
        echo   [√] 找到 npm.bat
    ) else (
        echo   [×] npm 未找到！
        goto end_pause
    )
)

echo.
echo [成功] 已找到 Node.js 相关路径:
echo        Node.exe: %NODE_EXE_PATH%
echo        npm.cmd : %NPM_CMD_PATH%
echo.

echo [步骤] 正在验证版本...
echo Node.js 版本:
"%NODE_EXE_PATH%" -v
echo npm 版本:
call "%NPM_CMD_PATH%" -v
echo.

echo [步骤] 正在保存完整路径配置...

if exist "_node_path.cfg" (
    attrib -r "_node_path.cfg" 2>nul
    del "_node_path.cfg" 2>nul
)

(
    echo %NODE_EXE_PATH%
    echo %NPM_CMD_PATH%
) > _node_path.cfg

if not exist "_node_path.cfg" (
    echo [错误] 无法创建配置文件！[DEBUG] 可能的原因：权限不足或磁盘空间不足
    goto end_pause
)

echo [DEBUG] 验证配置文件内容:
echo ----------------------------------------
type "_node_path.cfg"
echo ----------------------------------------
echo.
   
echo.
echo ======================================================
echo      配置已保存到 _node_path.cfg  环境准备就绪！
echo ======================================================
echo.
echo [下一步] 您可以：
echo   1. 运行 "3.快速启动-内置安装依赖.bat" (完整启动)
echo   2. 或分别运行简化脚本：
echo      - "依赖安装.bat" (仅安装依赖)
echo      - "直接启动服务器.bat" (仅启动服务器)
echo      - "直接启动网页.bat" (仅打开网页)
echo.

:end_pause
echo 按任意键退出...
pause > nul