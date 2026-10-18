# 钢铁工坊 ⚒️

**钢铁雄心4（Hearts of Iron IV）模组编辑器** — Windows 桌面版

直接读写你电脑里的模组文件夹：保存即生效，进游戏就能玩。为单国重置类模组（国策树、事件、决议、民族精神、人物、本地化）量身打造，全中文界面。

## ✨ 主要功能

- **国策树可视化编辑**：拖拽节点、条件/效果结构化管理、翻页 shortcut 可视化编辑
- **全套编辑器**：事件 / 决议 / 民族精神 / 人物 / 特质 / 本地化，彼此联动（事件↔国策双向跳转、本地化一键补全）
- **无损编辑**：只重写改过的条目，注释、空行、排版原样保留；保存前自动备份最近 10 份
- **中文搜索补全**：输入「军事」「政治点数」等中文提示词直接给出对应英文代码，附 142 条条件 + 187 条修饰符的中英文对照表
- **图标缩略图预览**：直接读取游戏 .gfx 精灵与 DDS 贴图
- **跨文件检查**：缺失本地化键、重复 GFX、缺失事件等一键扫描
- **双栏同屏编辑、撤销/重做、未保存确认、大模组性能优化**

## 📦 安装

- 最新安装包见右侧 **Releases**（`钢铁工坊-setup-x.x.x.exe`，Windows 10/11 64 位）
- 或从官网下载：http://www.dzyde.cn/steel-workshop/steel-workshop.html
- 安装包未做代码签名，SmartScreen 提示时点「更多信息 → 仍要运行」

首次启动后在设置里填入游戏目录（Hearts of Iron IV 安装位置）即可。

## 🔧 开发

```bash
cd app
npm install
npm run dev        # 开发模式
npm run typecheck  # 类型检查
npm test           # 单元测试
npm run dist       # 打包安装包（国内需设 ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR 指向 npmmirror）
```

技术栈：Electron + electron-vite + TypeScript + React 19。

## 📖 需求文档

[需求文档.md](需求文档.md)
