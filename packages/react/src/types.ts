/**
 * Claude Chat React Client Types
 *
 * TypeScript types for the React client hook.
 */

// =============================================================================
// Message Types (matches server)
// =============================================================================

export type MessageType = 'chat' | 'system';

export interface WebSocketMessage<T = unknown> {
  type: MessageType;
  seq: number;
  timestamp: number;
  sessionId?: string;
  payload: T;
}

// =============================================================================
// Chat Types
// =============================================================================

export type ChatAction =
  | 'send'
  | 'token'
  | 'complete'
  | 'error'
  | 'cancel'
  | 'tool_start'
  | 'tool_end'
  | 'thinking'
  | 'todo_update';

export interface ToolUseData {
  id: string;
  name: string;
  friendly?: string;
  input?: Record<string, unknown>;
  inputDetail?: string;
  result?: string;
  error?: string;
  summary?: string;
  duration?: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface ChatPayload {
  action: ChatAction;
  content?: string;
  tool?: ToolUseData;
  todos?: TodoItem[];
  error?: string;
}

// =============================================================================
// System Types
// =============================================================================

export type SystemAction =
  | 'connected'
  | 'catch_up'
  | 'snapshot'
  | 'subscribe'
  | 'error';

export interface ChatState {
  status: 'idle' | 'streaming' | 'complete' | 'error';
  accumulatedContent: string;
  tools: ToolUseData[];
  todos: TodoItem[] | null;
  errorMessage?: string;
}

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
// Hook Types
// =============================================================================

/**
 * Configuration for the useClaude hook.
 */
export interface UseClaudeOptions {
  /** WebSocket URL (e.g., "ws://localhost:3000/ws") */
  url: string;

  /** Session ID to resume (optional) */
  sessionId?: string;

  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;

  /** Reconnect on disconnect (default: true) */
  autoReconnect?: boolean;

  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;

  /** Reconnect delay in ms (default: 2000) */
  reconnectDelay?: number;

  /** Callback when connected */
  onConnect?: () => void;

  /** Callback when disconnected */
  onDisconnect?: () => void;

  /** Callback when error occurs */
  onError?: (error: string) => void;
}

/**
 * A message in the chat history.
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tools?: ToolUseData[];
  isStreaming?: boolean;
}

/**
 * Connection status.
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Return value from useClaude hook.
 */
export interface UseClaudeReturn {
  /** Current connection status */
  status: ConnectionStatus;

  /** Current session ID (if connected) */
  sessionId: string | null;

  /** Chat message history */
  messages: ChatMessage[];

  /** Currently streaming content (partial response) */
  streamingContent: string;

  /** Active tools currently being executed */
  activeTools: ToolUseData[];

  /** Completed tools from current response */
  completedTools: ToolUseData[];

  /** Current todo list (if Claude is using TodoWrite) */
  todos: TodoItem[] | null;

  /** Whether Claude is currently streaming a response */
  isStreaming: boolean;

  /** Current error message (if any) */
  error: string | null;

  /** Send a message to Claude */
  send: (content: string) => void;

  /** Cancel the current streaming response */
  cancel: () => void;

  /** Connect to the server */
  connect: () => void;

  /** Disconnect from the server */
  disconnect: () => void;

  /** Clear chat history */
  clearMessages: () => void;
}
