# Free Codex

> [中文版](README.md) | English

Free Codex is an Electron-based AI coding workbench that combines the official ChatGPT web experience with a local `codex-mcp` gateway, enabling ChatGPT to operate on local projects through MCP tools.

## Introduction

Free Codex provides a desktop development environment similar to an AI IDE, with support for local project management, file operations, a skill system, tool execution, and AI-assisted code modification.

## Features

### ChatGPT Desktop Integration

- Built with Electron + Vue 3
- Embeds the ChatGPT web page using Electron `WebContentsView`
- Desktop-first ChatGPT experience
- Theme and project context synchronization

### Local MCP Gateway

Integrates `codex-mcp` as the local AI execution gateway:

- Manages MCP services
- Exposes local tools to ChatGPT
- Manages MCP configuration
- Supports AI agent workflows

### Project Workspace

Supports:

- Selecting and switching project directories
- Browsing project files
- Injecting project context
- Referencing files with `@`

Example:

```text
@src/main/index.ts
```

### Skill System

Supports skill mechanisms similar to AI coding assistants:

```text
/skill:refactor
```

Used to define reusable AI workflows.

### File Change Management

Supports:

- Viewing file diffs
- Reviewing AI modifications
- Approving changes
- Rolling back modifications

### Overlay Window System

Provides through a dedicated overlay window:

- Command palette
- Diff viewer
- Toast notifications
- File picker

## Tech Stack

- Electron
- Vue 3
- TypeScript
- Vite
- Tailwind CSS
- shadcn-vue
- MCP
- codex-mcp

## Project Structure

```text
free-codex/
├── src/
│   ├── main/              # Electron main process
│   ├── preload/           # Bridge layer
│   ├── renderer/          # Frontend UI
│   └── renderer-overlay/  # Overlay UI
├── docs/
├── dist/
├── release/
└── package.json
```

## Requirements

- Windows 10+ (current packaging target is Windows)
- Development environment: Node.js >= 22 (required by the codex-mcp engine)
- The packaged app runs on Electron's bundled Node (Electron 32 bundles Node 20; upgrade to Electron >= 35 to fully satisfy the engine's Node 22 requirement)

## Development

Install dependencies:

```bash
npm install
```

Start in development mode:

```bash
npm run dev
```

Type checking:

```bash
npm run typecheck
```

Build:

```bash
npm run dist
```

## Configuration

Configurable options:

- MCP services
- Project directories
- Proxy settings
- Cloudflare Tunnel
- UI preferences
- Auto-start

## Architecture

```text
ChatGPT
   |
 MCP protocol
   |
codex-mcp gateway
   |
Free Codex desktop app
   |
Local project workspace
```

## Roadmap

- Monaco editor integration
- Built-in terminal
- File manager
- Agent goal planning
- Multi-file editing
- Project indexing and semantic search
- Cursor-like AI coding experience

## License

The project is currently in the development stage.
