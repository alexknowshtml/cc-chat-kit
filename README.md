# Claude Chat

A lightweight WebSocket wrapper around the Claude CLI for building chat interfaces with streaming support.

## What This Is

This package provides:

1. **Server** (`@anthropic/claude-chat-server`) - A Bun server that wraps the Claude CLI, exposing it via WebSocket with streaming support
2. **React Client** (`@anthropic/claude-chat-react`) - A React hook for building chat UIs that connect to the server

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

The server runs on `ws://localhost:3000/ws` by default.

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
import { createClaudeServer } from '@anthropic/claude-chat-server';

const server = createClaudeServer({
  port: 3000,
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

- `PORT` - Server port (default: 3000)
- `PROJECT_PATH` - Project directory for Claude CLI context (default: cwd)

## React Client Usage

```tsx
import { useClaude } from '@anthropic/claude-chat-react';

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
    url: 'ws://localhost:3000/ws',
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

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   React App     │ ◄────────────────► │   Bun Server    │
│   useClaude()   │                    │                 │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                │ spawn
                                                ▼
                                       ┌─────────────────┐
                                       │   Claude CLI    │
                                       │  stream-json    │
                                       └─────────────────┘
```

The server spawns Claude CLI with `--output-format stream-json` and parses the streaming output, broadcasting events to connected WebSocket clients.

## Features

- **Streaming** - Real-time token streaming as Claude responds
- **Tool Visibility** - See which tools Claude is using and their results
- **Todo Tracking** - Display Claude's task list from TodoWrite
- **Session Resume** - Continue previous conversations
- **Reconnection** - Automatic reconnect with exponential backoff
- **Catch-up** - Recover missed events after reconnection

## License

MIT
