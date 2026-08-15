# Free Codex

> [English](README.en.md) | 中文版

Free Codex 是一个基于 Electron 的 AI 编程工作台，将官方 ChatGPT 网页体验与本地 `codex-mcp` 网关结合，让 ChatGPT 可以通过 MCP 工具操作本地项目。

## 简介

Free Codex 提供类似 AI IDE 的桌面开发环境，支持本地项目管理、文件操作、技能系统、工具执行和 AI 辅助代码修改。

## 功能特性

### ChatGPT 桌面集成

- 基于 Electron + Vue 3 构建
- 使用 Electron `WebContentsView` 集成 ChatGPT 网页
- 支持桌面化 ChatGPT 使用体验
- 支持主题和项目上下文同步

### 本地 MCP 网关

集成 `codex-mcp` 作为本地 AI 执行网关：

- 管理 MCP 服务
- 向 ChatGPT 提供本地工具
- 管理 MCP 配置
- 支持 AI Agent 工作流

### 项目工作区

支持：

- 选择和切换项目目录
- 浏览项目文件
- 注入项目上下文
- 使用 `@` 引用文件

示例：

```text
@src/main/index.ts
```

### 技能系统

支持类似 AI 编程助手的技能机制：

```text
/skill:refactor
```

用于定义可复用的 AI 工作流程。

### 文件变更管理

支持：

- 查看文件 Diff
- 审核 AI 修改
- 确认变更
- 回滚修改

### 悬浮窗口系统

通过独立 Overlay 窗口提供：

- 命令面板
- Diff 查看器
- 消息提示
- 文件选择器

## 技术栈

- Electron
- Vue 3
- TypeScript
- Vite
- Tailwind CSS
- shadcn-vue
- MCP
- codex-mcp

## 项目结构

```text
free-codex/
├── src/
│   ├── main/              # Electron 主进程
│   ├── preload/           # 桥接层
│   ├── renderer/          # 前端界面
│   └── renderer-overlay/  # 悬浮界面
├── docs/
├── dist/
├── release/
└── package.json
```

## 环境要求

- Windows 10+（当前打包目标为 Windows）
- 开发环境：Node.js >= 22（codex-mcp 引擎要求）
- 打包后的应用运行在 Electron 内置 Node 上（Electron 32 内置 Node 20；后续升级 Electron >= 35 以完全满足引擎的 Node 22 要求）

## 开发

安装依赖：

```bash
npm install
```

启动：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

构建：

```bash
npm run dist
```

## 配置

支持配置：

- MCP 服务
- 项目目录
- 代理设置
- Cloudflare Tunnel
- UI 偏好
- 自动启动

## 架构

```text
ChatGPT
   |
 MCP 协议
   |
codex-mcp 网关
   |
Free Codex 桌面应用
   |
本地项目工作区
```

## 后续规划

- Monaco 编辑器集成
- 内置终端
- 文件管理器
- Agent 目标规划
- 多文件编辑
- 项目索引和语义搜索
- 类似 Cursor 的 AI 编程体验

## 许可证

项目目前处于开发阶段。
