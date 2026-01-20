# CC Chat Kit

> **⚠️ DISCLAIMER: This is an unofficial, community project. It is not affiliated with, endorsed by, or supported by Anthropic. Use at your own risk.**

A lightweight WebSocket wrapper around the Claude Code CLI for building chat interfaces with streaming support.

## What This Is

CC Chat Kit provides tools for building custom UIs on top of the Claude Code CLI:

1. **Server** (`cc-chat-server`) - A Bun server that wraps the Claude Code CLI, exposing it via WebSocket with streaming support
2. **React Client** (`cc-chat-react`) - A React hook for building chat UIs that connect to the server

This project wraps the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (Anthropic's official terminal tool) to enable building web-based interfaces. It does **not** use the Anthropic API directly—it spawns the CLI as a subprocess.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Start the server

```bash
# From the repo root
bun run dev:server

# Or directly
bun run packages/server/src/index.ts
```

The server runs on `ws://localhost:3457/ws` by default.

### 3. Run the example app

```bash
# In another terminal
cd examples/basic-chat
bun install
bun run dev
```

Open http://localhost:5173 to chat with Claude.

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
