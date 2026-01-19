@echo off
title 打开AI Studio网页

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

echo.
echo 已打开网页，请在浏览器中操作
timeout /t 3 >nul