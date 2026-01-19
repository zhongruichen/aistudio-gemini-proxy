@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

:: =================================================================
:: == 脚本: 3.快速启动-内置安装依赖.bat 
:: == 功能: 检查环境、安装依赖并启动所有服务，提供最完整的自动化流程。
:: =================================================================
title 3 - 项目完整启动

:: --- 核心修复: 强制将工作目录设置为脚本所在目录 ---
cd /d "%~dp0"
echo [SETUP] 工作目录已设置为: %cd%
echo.

:: --- 诊断日志: 显示当前目录内容 ---
echo [DEBUG] 检查当前目录文件:
if exist "_node_path.cfg" (
    echo   [√] _node_path.cfg 存在
) else (
    echo   [×] _node_path.cfg 不存在
)
if exist "dark-server.js" (
    echo   [√] dark-server.js 存在
) else (
    echo   [×] dark-server.js 不存在
)
echo.

:: --- 步骤 1: 检查并读取 Node.js 路径配置 ---
set "CONFIG_FILE=_node_path.cfg"
echo [STEP 1] 正在检查配置文件: %CONFIG_FILE%

if not exist "%CONFIG_FILE%" (
    echo [ERROR] 未找到 Node.js 路径配置文件!
    echo [HINT]  请先成功运行 "2Node.js 环境定位与检测脚本.bat"
    echo.
    echo [DEBUG] 当前工作目录: %cd%
    echo [DEBUG] 脚本所在目录: %~dp0
    goto :end_pause
)

:: 从配置文件安全地读取路径（修复语法错误）
set "NODE_EXE="
set "NPM_CMD="

:: 读取第一行（node.exe路径）
set /p NODE_EXE=<"%CONFIG_FILE%"

:: 读取第二行（npm.cmd路径）- 修复的关键部分
for /f "skip=1 delims=" %%i in (%CONFIG_FILE%) do (
    set "NPM_CMD=%%i"
    goto :npm_found
)
:npm_found

:: 诊断日志：显示读取的内容
echo [DEBUG] 从配置文件读取的内容:
echo   Node.exe: %NODE_EXE%
echo   npm.cmd: %NPM_CMD%
echo.

if not defined NODE_EXE (
    echo [ERROR] 无法从 %CONFIG_FILE% 中读取 node.exe 路径。
    echo [DEBUG] 配置文件内容:
    type "%CONFIG_FILE%"
    goto :end_pause
)

if not defined NPM_CMD (
    echo [ERROR] 无法从 %CONFIG_FILE% 中读取 npm.cmd 路径。
    echo [DEBUG] 配置文件内容:
    type "%CONFIG_FILE%"
    goto :end_pause
)

:: 验证路径是否有效
if not exist "%NODE_EXE%" (
    echo [ERROR] Node.exe 路径无效: %NODE_EXE%
    goto :end_pause
)

if not exist "%NPM_CMD%" (
    echo [ERROR] npm.cmd 路径无效: %NPM_CMD%
    goto :end_pause
)

echo [OK] 路径验证成功
echo.

:: --- 步骤 2: 检查并安装项目核心依赖 ---
echo [STEP 2] 正在检查项目依赖 (express, ws, cors)...

:: 检查每个依赖是否存在
set "NEED_INSTALL=0"
if not exist "node_modules\express" (
    echo   [×] express 未安装
    set "NEED_INSTALL=1"
) else (
    echo   [√] express 已安装
)

if not exist "node_modules\ws" (
    echo   [×] ws 未安装
    set "NEED_INSTALL=1"
) else (
    echo   [√] ws 已安装
)

if not exist "node_modules\cors" (
    echo   [×] cors 未安装
    set "NEED_INSTALL=1"
) else (
    echo   [√] cors 已安装
)

if not exist "node_modules\tiny-pinyin" (
    echo   [×] tiny-pinyin 未安装
    set "NEED_INSTALL=1"
) else (
    echo   [√] tiny-pinyin 已安装
)

if "%NEED_INSTALL%"=="1" (
    echo.
    echo [INFO] 开始安装缺失的依赖...
    echo [HINT] 此过程可能需要几分钟，具体取决于您的网络速度。
    echo.
    
    :: 使用call确保正确执行npm
    call "%NPM_CMD%" install express ws cors tiny-pinyin
    
    if !errorlevel! neq 0 (
        echo [ERROR] 依赖安装失败！错误代码: !errorlevel!
        echo [HINT] 请检查网络连接或尝试手动运行: npm install express ws cors tiny-pinyin
        goto :end_pause
    )
    echo.
    echo [SUCCESS] 所有依赖已成功安装！
) else (
    echo [OK] 所有依赖已存在，跳过安装。
)
echo.

:: --- 步骤 3: 启动服务器和相关网页 ---
echo [STEP 3] 正在启动服务和网页...
echo [INFO] 后台启动 dark-server.js...

:: 使用更安全的启动方式（在新窗口内也强制 UTF-8，避免日志乱码）
start "Node_Server" cmd /c "chcp 65001>nul & cd /d "%~dp0" & "%NODE_EXE%" "dark-server.js" & pause"

echo [INFO] 等待服务器启动...
timeout /t 3 /nobreak > nul

echo [INFO] 在默认浏览器中打开 AI Studio 网页代理...
set "config_file=proxy-config.txt"
set "proxy_url="

if not exist "%config_file%" (
    echo 错误：找不到配置文件 %config_file%
    echo 请确保proxy-config.txt文件存在
    pause
    exit /b 1
)

for /f "tokens=* delims=" %%a in ('type "%config_file%" ^| findstr /v "^#"') do (
    if not defined proxy_url set "proxy_url=%%a"
)

if not defined proxy_url (
    echo 错误：配置文件中没有找到有效的URL
    echo 请在proxy-config.txt中添加AI Studio链接
    pause
    exit /b 1
)

echo 正在打开AI Studio网页...
echo URL: %proxy_url%
start "" "%proxy_url%"

echo [INFO] 等待服务器完全启动...
timeout /t 2 /nobreak > nul

echo [INFO] 打开监控面板...
start "" "http://127.0.0.1:8889/monitor"

echo.
echo =================================================================
echo                    项目已成功启动！
echo =================================================================
echo.
echo [IMPORTANT] Node.js 服务器窗口已在后台运行。您可以最小化它，但请勿关闭，否则代理会中断。
echo.
echo [INFO] 监控面板地址: http://127.0.0.1:8889/monitor 您可以在此查看请求统计、连接池状态等信息
echo.

:end_pause
echo 此启动脚本任务完成，按任意键退出。
pause > nul
endlocal
