/**
 * Claude Chat WebSocket Protocol Types
 *
 * Defines the message protocol between server and client.
 */

// =============================================================================
// Message Types
// =============================================================================

/**
 * Top-level message categories.
 */
export type MessageType = 'chat' | 'system';

/**
 * Base message structure - all messages include these fields.
 */
export interface WebSocketMessage<T = unknown> {
  type: MessageType;
  seq: number;        // Monotonic sequence number for ordering/catch-up
  timestamp: number;  // Unix timestamp ms
  sessionId?: string; // Claude session ID
  payload: T;
}

// =============================================================================
// Chat Payloads
// =============================================================================

/**
 * Chat message actions.
 */
export type ChatAction =
  | 'send'        // User sends a message
  | 'token'       // Streaming text token from Claude
  | 'complete'    // Response complete
  | 'error'       // Error occurred
  | 'cancel'      // Cancel ongoing response
  | 'tool_start'  // Tool execution started
  | 'tool_end'    // Tool execution completed
  | 'thinking'    // Claude is processing (no output yet)
  | 'todo_update'; // Todo list updated

/**
 * Tool use data.
 */
export interface ToolUseData {
  id: string;
  name: string;
  friendly?: string;      // Human-friendly name (e.g., "Reading file.ts")
  input?: Record<string, unknown>;
  inputDetail?: string;   // Short description of input
  result?: string;
  error?: string;
  summary?: string;       // Short summary of result
  duration?: number;      // Execution time in ms
}

/**
 * Todo item from Claude's TodoWrite tool.
 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/**
 * Chat message payload.
 */
export interface ChatPayload {
  action: ChatAction;
  content?: string;
  tool?: ToolUseData;
  todos?: TodoItem[];
  error?: string;
}

// =============================================================================
// System Payloads
// =============================================================================

/**
 * System message actions.
 */
export type SystemAction =
  | 'connected'     // Initial connection with state snapshot
  | 'catch_up'      // Client requests missed events
  | 'snapshot'      // Server sends state snapshot
  | 'subscribe'     // Client subscribes to a session
  | 'error';        // System-level error

/**
 * Chat state for catch-up/reconnection.
 */
export interface ChatState {
  status: 'idle' | 'streaming' | 'complete' | 'error';
  accumulatedContent: string;
  tools: ToolUseData[];
  todos: TodoItem[] | null;
  errorMessage?: string;
}

/**
 * System message payload.
 */
export interface SystemPayload {
  action: SystemAction;
  sessionId?: string;
  lastSeq?: number;
  currentSeq?: number;
  events?: WebSocketMessage[];
  chatState?: ChatState;
  error?: string;
}

// =============================================================================
// Server Configuration
// =============================================================================

/**
 * Configuration for the Claude chat server.
 */
export interface ClaudeServerConfig {
  /** Port to listen on (default: 3000) */
  port?: number;

  /** Project directory for Claude CLI context (default: cwd) */
  projectPath?: string;

  /** Path to Claude CLI binary (auto-detected if not provided) */
  claudePath?: string;

  /** Callback when a client connects */
  onConnect?: (clientId: string) => void;

  /** Callback when a client disconnects */
  onDisconnect?: (clientId: string) => void;

  /** Callback when Claude starts processing */
  onStreamStart?: (sessionId: string) => void;

  /** Callback when Claude finishes processing */
  onStreamEnd?: (sessionId: string) => void;
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Client data attached to WebSocket connections.
 */
export interface WebSocketClientData {
  clientId: string;
  sessionId?: string;
  connectedAt: Date;
  lastPing: Date;
  lastSeq: number;
}

/**
 * Active Claude process tracking.
 */
export interface ActiveProcess {
  proc: ReturnType<typeof Bun.spawn>;
  sessionId: string;
  aborted: boolean;
  startedAt: number;
}

/**
 * Active tool tracking during streaming.
 */
export interface ActiveTool {
  id: string;
  name: string;
  friendly: string;
  startTime: number;
}

// =============================================================================
// Constants
// =============================================================================

export const WS_CONFIG = {
  /** Ping interval in milliseconds */
  PING_INTERVAL_MS: 30_000,

  /** Maximum events to buffer per session */
  MAX_BUFFER_SIZE: 100,

  /** How long to keep events in buffer (5 minutes) */
  BUFFER_TTL_MS: 5 * 60 * 1000,

  /** Buffer for stdout parsing (handles large tool outputs) */
  MAX_STDOUT_BUFFER: 20 * 1024 * 1024, // 20MB
} as const;
