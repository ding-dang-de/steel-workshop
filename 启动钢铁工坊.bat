@echo off
rem 钢铁工坊开发版启动脚本：双击即可打开
cd /d "D:\模组编辑器\app"
echo Starting Steel Workshop dev...
npm run dev
if errorlevel 1 pause
