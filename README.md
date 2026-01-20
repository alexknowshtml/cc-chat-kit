# CC Chat Kit

> **⚠️ DISCLAIMER: This is an unofficial, community project. It is not affiliated with, endorsed by, or supported by Anthropic. Use at your own risk.**

## Why CC Chat Kit?

**You love Claude Code. You want to use it from anywhere.**

Claude Code is powerful, but it's tied to your terminal. CC Chat Kit lets you build a web interface so you can chat with Claude from your phone, tablet, or any browser—while Claude Code runs on your home machine or a cloud VM.

**Common setups:**
- 🏠 **Home workstation** → Access from your phone on the couch
- ☁️ **Cloud VM** → Chat from any device, anywhere
- 💻 **Work laptop** → Continue conversations from your personal phone

The key: run CC Chat Kit on the same machine where Claude Code is installed and authenticated. Then connect to it remotely.

## What's Included

1. **Server** (`cc-chat-server`) - A Bun server that wraps the Claude Code CLI, exposing it via WebSocket with streaming support
2. **React Client** (`cc-chat-react`) - A React hook for building chat UIs that connect to the server

This project wraps the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (Anthropic's official terminal tool) to enable building web-based interfaces. It does **not** use the Anthropic API directly—it spawns the CLI as a subprocess.

## Quick Start

### 1. Install dependencies

```bash
git clone https://github.com/alexknowshtml/cc-chat-kit.git
cd cc-chat-kit
bun install
```

### 2. Start the server

```bash
bun run dev:server
```

The server runs on `ws://localhost:3457/ws` by default.

### 3. Run the example app

```bash
# In another terminal
cd examples/basic-chat
bun install
bun run dev
```

Open http://localhost:3456 to chat with Claude.

---

## ⚠️ Security: LAN Only

**Do NOT expose CC Chat Kit directly to the public internet.**

This server gives full access to Claude Code on your machine, which can read/write files, execute commands, and more. Exposing it publicly is a significant security risk.

**Safe options:**
- Run on your local network (LAN) only
- Use Tailscale (recommended) for secure remote access
- Never port-forward ports 3456/3457 to the internet

---

## Remote Access with Tailscale (Recommended)

To access CC Chat Kit from your phone or other devices, we recommend [Tailscale](https://tailscale.com)—a zero-config VPN that creates a secure private network between your devices. Unlike exposing ports to the internet, Tailscale keeps your traffic encrypted and private.

**Why Tailscale?**
- No port forwarding or firewall configuration needed
- Works across home networks, mobile data, and cloud VMs
- Free for personal use (up to 100 devices)
- Takes about 5 minutes to set up

**Setup overview:**
1. Install Tailscale on your CC Chat Kit server (home machine or cloud VM)
2. Install Tailscale on your phone/tablet
3. Both devices get private IPs (like `100.x.x.x`) that can reach each other
4. Access your chat UI at `http://100.x.x.x:3456` from anywhere

**Getting started:**
- [Tailscale Quickstart Guide](https://tailscale.com/kb/1017/install)
- [How to Use Tailscale: Step-by-Step Setup Guide for Beginners](https://www.learnlinux.tv/how-to-use-tailscale-step-by-step-setup-guide-for-beginners/) (video tutorial)

**Tip:** After installing Tailscale, update the `WS_URL` in your example app to use your Tailscale IP:
```typescript
const WS_URL = 'ws://100.x.x.x:3457/ws';  // Your Tailscale IP
```

---

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js 18+ (for the React client)

## Dependencies

### Server (`cc-chat-server`)
- Bun runtime (uses `Bun.serve` and `Bun.spawn`)
- No external npm dependencies

### React Client (`cc-chat-react`)
- React 18+
- [Zod](https://zod.dev) (runtime payload validation)

### Example App (optional dependencies for markdown rendering)
- [streamdown](https://www.npmjs.com/package/streamdown) - Streaming markdown renderer

## Server Usage

```typescript
import { createClaudeServer } from 'cc-chat-server';

const server = createClaudeServer({
  port: 3457,
  projectPath: '/path/to/your/project',  // CWD for Claude CLI
  claudePath: '~/.local/bin/claude',     // Optional, auto-detected

  // Callbacks
  onConnect: (clientId) => console.log(`Client connected: ${clientId}`),
  onDisconnect: (clientId) => console.log(`Client disconnected: ${clientId}`),
  onStreamStart: (sessionId) => console.log(`Stream started: ${sessionId}`),
  onStreamEnd: (sessionId) => console.log(`Stream ended: ${sessionId}`),
});

server.start();
```

### Environment Variables

- `PORT` - Server port (default: 3457)
- `PROJECT_PATH` - Project directory for Claude CLI context (default: cwd)

## React Client Usage

```tsx
import { useClaude } from 'cc-chat-react';

function Chat() {
  const {
    status,        // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    messages,      // Chat history
    streamingContent,  // Current streaming text
    activeTools,   // Tools currently running
    todos,         // Todo list from TodoWrite tool
    isStreaming,   // Whether Claude is responding
    error,         // Current error (if any)
    send,          // Send a message
    cancel,        // Cancel current response
  } = useClaude({
    url: 'ws://localhost:3457/ws',
    sessionId: 'optional-resume-id',  // Resume a previous session
  });

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>
          <strong>{m.role}:</strong> {m.content}
        </div>
      ))}

      {isStreaming && <div>Claude: {streamingContent}</div>}

      <input
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            send(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
    </div>
  );
}
```

### Hook Options

```typescript
interface UseClaudeOptions {
  url: string;                    // WebSocket URL
  sessionId?: string;             // Resume session ID
  autoConnect?: boolean;          // Connect on mount (default: true)
  autoReconnect?: boolean;        // Reconnect on disconnect (default: true)
  maxReconnectAttempts?: number;  // Max retries (default: 5)
  reconnectDelay?: number;        // Delay in ms (default: 2000)
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}
```

### Return Value

```typescript
interface UseClaudeReturn {
  status: ConnectionStatus;
  sessionId: string | null;
  messages: ChatMessage[];
  streamingContent: string;
  activeTools: ToolUseData[];
  completedTools: ToolUseData[];
  todos: TodoItem[] | null;
  isStreaming: boolean;
  error: string | null;
  send: (content: string) => void;
  cancel: () => void;
  connect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
}
```

## WebSocket Protocol

### Message Format

All messages follow this structure:

```typescript
interface WebSocketMessage<T> {
  type: 'chat' | 'system';
  seq: number;        // Sequence number for ordering
  timestamp: number;  // Unix timestamp ms
  sessionId?: string;
  payload: T;
}
```

### Chat Actions

| Action | Direction | Description |
|--------|-----------|-------------|
| `send` | Client → Server | Send a message to Claude |
| `token` | Server → Client | Streaming text token |
| `tool_start` | Server → Client | Tool execution started |
| `tool_end` | Server → Client | Tool execution completed |
| `todo_update` | Server → Client | Todo list updated |
| `complete` | Server → Client | Response complete |
| `error` | Server → Client | Error occurred |
| `cancel` | Client → Server | Cancel current response |

### System Actions

| Action | Direction | Description |
|--------|-----------|-------------|
| `connected` | Server → Client | Connection established |
| `subscribe` | Client → Server | Subscribe to a session |
| `catch_up` | Client → Server | Request missed events |
| `snapshot` | Server → Client | State snapshot for catch-up |

## Architecture

### System Overview

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   React App     │ ◄────────────────► │   Bun Server    │
│   useClaude()   │    (port 3457)     │                 │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                │ Bun.spawn()
                                                ▼
                                       ┌─────────────────┐
                                       │   Claude CLI    │
                                       │  stream-json    │
                                       └─────────────────┘
```

The server spawns Claude CLI with `--output-format stream-json` and parses the streaming output, broadcasting events to connected WebSocket clients.

### Message Flow

```
User types message
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  React Hook (useClaude)                                       │
│  ┌─────────────────┐                                          │
│  │ send("hello")   │──────► WebSocket.send({                  │
│  └─────────────────┘          type: "chat",                   │
│                               payload: { action: "send" }     │
│                             })                                │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Bun Server                                                   │
│  ┌─────────────────┐    ┌──────────────────────────────────┐  │
│  │ Parse message   │───►│ Spawn: claude -p "hello"         │  │
│  └─────────────────┘    │        --output-format stream-json│  │
│                         └──────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Claude CLI streams JSON events                               │
│                                                               │
│  {"type":"assistant","message":{"content":[{"type":"text"...  │
│  {"type":"content_block_delta","delta":{"text":"Hello"}}      │
│  {"type":"content_block_delta","delta":{"text":"!"}}          │
│  {"type":"result","result":"success"}                         │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Server parses stream, broadcasts to clients                  │
│                                                               │
│  ──► { type: "chat", payload: { action: "token",              │
│        content: "Hello" }}                                    │
│  ──► { type: "chat", payload: { action: "token",              │
│        content: "!" }}                                        │
│  ──► { type: "chat", payload: { action: "complete" }}         │
└───────────────────────────────────────────────────────────────┘
```

### Tool Execution Flow

```
Claude decides to use a tool
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Server receives tool_use from CLI                            │
│                                                               │
│  {"type":"content_block_start",                               │
│   "content_block":{"type":"tool_use","name":"Read",...}}      │
└───────────────────────────────────────────────────────────────┘
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────────┐
│ Broadcast to client │              │ Track in activeTools    │
│                     │              │ (server-side state)     │
│ { action: "tool_start",            └─────────────────────────┘
│   tool: {                                    │
│     id: "tool_xxx",                          │
│     name: "Read",                            │ Tool executes...
│     friendly: "Reading file",                │
│     startTime: 1234567890                    │
│   }                                          ▼
│ }                              ┌─────────────────────────────┐
└─────────────────────┘          │ Tool completes, CLI outputs │
                                 │ tool_result event           │
                                 └─────────────────────────────┘
                                               │
                                               ▼
                                 ┌─────────────────────────────┐
                                 │ Broadcast to client         │
                                 │                             │
                                 │ { action: "tool_end",       │
                                 │   tool: {                   │
                                 │     id: "tool_xxx",         │
                                 │     duration: 1234,         │
                                 │     summary: "Read 50 lines"│
                                 │   }                         │
                                 │ }                           │
                                 └─────────────────────────────┘
```

### Interleaved Content Blocks

The UI renders content in the order it occurs, not grouped by type:

```
┌─────────────────────────────────────────────────────────────┐
│ Claude's Response                                           │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TEXT BLOCK                                             │ │
│  │ "Let me check that file for you."                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TOOL GROUP                                             │ │
│  │ ┌────────────────────────────────────────────────────┐ │ │
│  │ │ ✓ Reading file src/index.ts          0.3s         │ │ │
│  │ │   export function main() { ...                    │ │ │
│  │ └────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TEXT BLOCK                                             │ │
│  │ "I see the issue. The function is missing a return    │ │
│  │  statement. Let me fix that."                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TOOL GROUP                                             │ │
│  │ ┌────────────────────────────────────────────────────┐ │ │
│  │ │ ✓ Editing file src/index.ts          0.5s         │ │ │
│  │ │   Added return statement                          │ │ │
│  │ └────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TEXT BLOCK                                             │ │
│  │ "Done! The function now returns the expected value."   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This is tracked via `ContentBlock` types in the React hook:

```typescript
type ContentBlock =
  | { type: 'text'; content: string; timestamp: number }
  | { type: 'tool_group'; tools: ToolUseData[]; timestamp: number };
```

### Session Reconnection

```
Client disconnects (network issue, etc.)
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  React Hook detects disconnect                                │
│  - Sets status = 'reconnecting'                               │
│  - Saves lastSeq (last message sequence number)               │
└───────────────────────────────────────────────────────────────┘
        │
        │ Exponential backoff (2s, 4s, 8s...)
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Reconnect attempt                                            │
│  - Opens new WebSocket                                        │
│  - Sends subscribe with sessionId                             │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Server receives subscribe                                    │
│  - Finds session state                                        │
│  - Sends snapshot of current state                            │
│  - Client catches up on missed events                         │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Client restored                                              │
│  - Messages, tools, todos all synced                          │
│  - status = 'connected'                                       │
│  - Streaming continues if in progress                         │
└───────────────────────────────────────────────────────────────┘
```

## Features

- **Streaming** - Real-time token streaming as Claude responds
- **Tool Visibility** - See which tools Claude is using and their results
- **Todo Tracking** - Display Claude's task list from TodoWrite
- **Session Resume** - Continue previous conversations
- **Reconnection** - Automatic reconnect with exponential backoff
- **Catch-up** - Recover missed events after reconnection

## Disclaimer

**This is an unofficial, community-developed project.**

- CC Chat Kit is **not** affiliated with, endorsed by, or supported by Anthropic
- "Claude" and "Claude Code" are trademarks of Anthropic
- This project wraps the Claude Code CLI—it does not access Anthropic's API directly
- No guarantees are made about compatibility with future CLI versions
- Use at your own risk

For official Anthropic products and documentation, visit [anthropic.com](https://anthropic.com).

## License

MIT
