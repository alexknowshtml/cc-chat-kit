/**
 * WebSocket Connection Manager
 *
 * Handles client connections, session subscriptions, and message broadcasting.
 */

import type { ServerWebSocket } from 'bun';
import type {
  WebSocketMessage,
  WebSocketClientData,
  ChatPayload,
  SystemPayload,
  ChatState,
  WS_CONFIG,
} from './types';

// =============================================================================
// Types
// =============================================================================

export type ClaudeWebSocket = ServerWebSocket<WebSocketClientData>;

// =============================================================================
// State
// =============================================================================

/** Connected clients */
const clients = new Set<ClaudeWebSocket>();

/** Event buffers per session for catch-up */
const sessionBuffers = new Map<string, WebSocketMessage[]>();

/** Global sequence counter */
let globalSeq = 0;

/** Per-session sequence counters */
const sessionSeqs = new Map<string, number>();

/** Active chat state per session (for catch-up) */
const chatStates = new Map<string, ChatState>();

// =============================================================================
// Client Management
// =============================================================================

/**
 * Generate a unique client ID.
 */
function generateClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Register a new WebSocket client.
 */
export function registerClient(ws: ClaudeWebSocket): void {
  // Initialize client data
  ws.data = {
    clientId: generateClientId(),
    connectedAt: new Date(),
    lastPing: new Date(),
    lastSeq: 0,
  };

  clients.add(ws);

  // Send connected message with current state
  const connectedMessage: WebSocketMessage<SystemPayload> = {
    type: 'system',
    seq: ++globalSeq,
    timestamp: Date.now(),
    payload: {
      action: 'connected',
      currentSeq: globalSeq,
    },
  };

  ws.send(JSON.stringify(connectedMessage));

  console.log(`[WS] Client connected: ${ws.data.clientId}. Total: ${clients.size}`);
}

/**
 * Unregister a WebSocket client.
 */
export function unregisterClient(ws: ClaudeWebSocket): void {
  clients.delete(ws);
  console.log(`[WS] Client disconnected: ${ws.data?.clientId}. Total: ${clients.size}`);
}

/**
 * Subscribe a client to a session.
 */
export function subscribeToSession(ws: ClaudeWebSocket, sessionId: string): void {
  ws.data.sessionId = sessionId;
  console.log(`[WS] Client ${ws.data.clientId} subscribed to session ${sessionId.substring(0, 8)}`);

  // Send current chat state if available
  const chatState = chatStates.get(sessionId);
  if (chatState) {
    const stateMessage: WebSocketMessage<SystemPayload> = {
      type: 'system',
      seq: ++globalSeq,
      timestamp: Date.now(),
      sessionId,
      payload: {
        action: 'snapshot',
        sessionId,
        chatState,
        currentSeq: getSessionSeq(sessionId),
      },
    };
    ws.send(JSON.stringify(stateMessage));
  }
}

/**
 * Unsubscribe a client from their session.
 */
export function unsubscribeFromSession(ws: ClaudeWebSocket): void {
  const sessionId = ws.data.sessionId;
  ws.data.sessionId = undefined;
  if (sessionId) {
    console.log(`[WS] Client ${ws.data.clientId} unsubscribed from session ${sessionId.substring(0, 8)}`);
  }
}

/**
 * Get client count.
 */
export function getClientCount(): number {
  return clients.size;
}

// =============================================================================
// Message Handling
// =============================================================================

/**
 * Handle incoming message from a client.
 */
export function handleClientMessage(
  ws: ClaudeWebSocket,
  message: string,
  onChat: (ws: ClaudeWebSocket, sessionId: string | undefined, content: string) => void,
  onCancel: (sessionId: string) => void
): void {
  try {
    const parsed = JSON.parse(message) as WebSocketMessage;

    if (parsed.type === 'chat') {
      const payload = parsed.payload as ChatPayload;

      if (payload.action === 'send' && payload.content) {
        onChat(ws, ws.data.sessionId, payload.content);
      } else if (payload.action === 'cancel' && ws.data.sessionId) {
        onCancel(ws.data.sessionId);
      }
    } else if (parsed.type === 'system') {
      const payload = parsed.payload as SystemPayload;

      if (payload.action === 'subscribe' && payload.sessionId) {
        subscribeToSession(ws, payload.sessionId);
      } else if (payload.action === 'catch_up') {
        handleCatchUp(ws, payload.sessionId, payload.lastSeq || 0);
      }
    }
  } catch (err) {
    console.error('[WS] Failed to parse message:', err);
  }
}

/**
 * Handle catch-up request from a reconnecting client.
 */
function handleCatchUp(
  ws: ClaudeWebSocket,
  sessionId: string | undefined,
  lastSeq: number
): void {
  if (!sessionId) {
    return;
  }

  const buffer = sessionBuffers.get(sessionId) || [];
  const missedEvents = buffer.filter((e) => e.seq > lastSeq);
  const chatState = chatStates.get(sessionId);

  const response: WebSocketMessage<SystemPayload> = {
    type: 'system',
    seq: ++globalSeq,
    timestamp: Date.now(),
    sessionId,
    payload: {
      action: 'snapshot',
      sessionId,
      events: missedEvents,
      chatState,
      currentSeq: getSessionSeq(sessionId),
    },
  };

  ws.send(JSON.stringify(response));
  console.log(`[WS] Sent ${missedEvents.length} catch-up events to ${ws.data.clientId}`);
}

// =============================================================================
// Broadcasting
// =============================================================================

/**
 * Get or create session sequence counter.
 */
function getSessionSeq(sessionId: string): number {
  let seq = sessionSeqs.get(sessionId);
  if (seq === undefined) {
    seq = 0;
    sessionSeqs.set(sessionId, seq);
  }
  return seq;
}

/**
 * Increment and return session sequence.
 */
function nextSessionSeq(sessionId: string): number {
  const seq = getSessionSeq(sessionId) + 1;
  sessionSeqs.set(sessionId, seq);
  return seq;
}

/**
 * Buffer an event for catch-up.
 */
function bufferEvent(sessionId: string, event: WebSocketMessage): void {
  let buffer = sessionBuffers.get(sessionId);
  if (!buffer) {
    buffer = [];
    sessionBuffers.set(sessionId, buffer);
  }

  buffer.push(event);

  // Trim buffer if too large
  const MAX_BUFFER_SIZE = 100;
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }
}

/**
 * Broadcast a chat event to clients subscribed to a session.
 */
export function broadcastChat(
  sessionId: string,
  payload: ChatPayload
): WebSocketMessage<ChatPayload> {
  const message: WebSocketMessage<ChatPayload> = {
    type: 'chat',
    seq: nextSessionSeq(sessionId),
    timestamp: Date.now(),
    sessionId,
    payload,
  };

  // Buffer for catch-up
  bufferEvent(sessionId, message);

  // Update chat state
  updateChatState(sessionId, payload);

  // Send to subscribed clients
  const messageStr = JSON.stringify(message);
  let sent = 0;

  for (const client of clients) {
    if (client.data.sessionId === sessionId) {
      try {
        client.send(messageStr);
        sent++;
      } catch {
        clients.delete(client);
      }
    }
  }

  return message;
}

/**
 * Broadcast to all connected clients.
 */
export function broadcastAll(message: WebSocketMessage): void {
  const messageStr = JSON.stringify(message);

  for (const client of clients) {
    try {
      client.send(messageStr);
    } catch {
      clients.delete(client);
    }
  }
}

// =============================================================================
// Chat State Management
// =============================================================================

/**
 * Update the chat state for a session.
 */
function updateChatState(sessionId: string, payload: ChatPayload): void {
  let state = chatStates.get(sessionId);

  if (!state) {
    state = {
      status: 'idle',
      accumulatedContent: '',
      tools: [],
      todos: null,
    };
    chatStates.set(sessionId, state);
  }

  switch (payload.action) {
    case 'token':
      state.status = 'streaming';
      state.accumulatedContent += payload.content || '';
      break;

    case 'tool_start':
      state.status = 'streaming';
      if (payload.tool) {
        state.tools.push({ ...payload.tool });
      }
      break;

    case 'tool_end':
      if (payload.tool) {
        const tool = state.tools.find((t) => t.id === payload.tool!.id);
        if (tool) {
          Object.assign(tool, payload.tool);
        }
      }
      break;

    case 'todo_update':
      if (payload.todos) {
        state.todos = payload.todos;
      }
      break;

    case 'complete':
      state.status = 'complete';
      break;

    case 'error':
      state.status = 'error';
      state.errorMessage = payload.error;
      break;
  }
}

/**
 * Reset chat state for a new message.
 */
export function resetChatState(sessionId: string): void {
  chatStates.set(sessionId, {
    status: 'streaming',
    accumulatedContent: '',
    tools: [],
    todos: null,
  });
}

/**
 * Get chat state for a session.
 */
export function getChatState(sessionId: string): ChatState | undefined {
  return chatStates.get(sessionId);
}

// =============================================================================
// Convenience Broadcast Functions
// =============================================================================

export function broadcastToken(sessionId: string, text: string): void {
  broadcastChat(sessionId, { action: 'token', content: text });
}

export function broadcastToolStart(
  sessionId: string,
  tool: ChatPayload['tool']
): void {
  broadcastChat(sessionId, { action: 'tool_start', tool });
}

export function broadcastToolEnd(
  sessionId: string,
  tool: ChatPayload['tool']
): void {
  broadcastChat(sessionId, { action: 'tool_end', tool });
}

export function broadcastTodoUpdate(
  sessionId: string,
  todos: ChatPayload['todos']
): void {
  broadcastChat(sessionId, { action: 'todo_update', todos });
}

export function broadcastThinking(sessionId: string, message: string): void {
  broadcastChat(sessionId, { action: 'thinking', content: message });
}

export function broadcastComplete(sessionId: string, result?: string): void {
  broadcastChat(sessionId, { action: 'complete', content: result });
}

export function broadcastError(sessionId: string, error: string): void {
  broadcastChat(sessionId, { action: 'error', error });
}

// =============================================================================
// Periodic Tasks
// =============================================================================

let pingInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic ping and cleanup tasks.
 */
export function startPeriodicTasks(): void {
  // Ping every 30 seconds
  pingInterval = setInterval(() => {
    if (clients.size === 0) return;

    const ping: WebSocketMessage<SystemPayload> = {
      type: 'system',
      seq: ++globalSeq,
      timestamp: Date.now(),
      payload: { action: 'connected' }, // Using 'connected' as ping
    };

    broadcastAll(ping);
  }, 30_000);

  // Cleanup old buffers every minute
  cleanupInterval = setInterval(() => {
    const BUFFER_TTL = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    for (const [sessionId, buffer] of sessionBuffers) {
      // Remove events older than TTL
      const cutoff = now - BUFFER_TTL;
      const filtered = buffer.filter((e) => e.timestamp > cutoff);

      if (filtered.length === 0) {
        sessionBuffers.delete(sessionId);
        sessionSeqs.delete(sessionId);
        chatStates.delete(sessionId);
      } else if (filtered.length < buffer.length) {
        sessionBuffers.set(sessionId, filtered);
      }
    }
  }, 60_000);
}

/**
 * Stop periodic tasks.
 */
export function stopPeriodicTasks(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// =============================================================================
// Bun WebSocket Handler
// =============================================================================

/**
 * Create the Bun WebSocket handler.
 */
export function createWebSocketHandler(
  onChat: (ws: ClaudeWebSocket, sessionId: string | undefined, content: string) => void,
  onCancel: (sessionId: string) => void
): {
  open: (ws: ClaudeWebSocket) => void;
  message: (ws: ClaudeWebSocket, message: string | Buffer) => void;
  close: (ws: ClaudeWebSocket) => void;
} {
  return {
    open(ws: ClaudeWebSocket) {
      registerClient(ws);
    },

    message(ws: ClaudeWebSocket, message: string | Buffer) {
      const str = typeof message === 'string' ? message : message.toString();
      handleClientMessage(ws, str, onChat, onCancel);
    },

    close(ws: ClaudeWebSocket) {
      unregisterClient(ws);
    },
  };
}
