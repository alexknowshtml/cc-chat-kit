/**
 * Claude Chat Server
 *
 * A lightweight Bun server that wraps the Claude CLI with WebSocket streaming.
 *
 * Usage:
 * ```typescript
 * import { createClaudeServer } from '@anthropic/claude-chat-server';
 *
 * const server = createClaudeServer({
 *   port: 3000,
 *   projectPath: process.cwd(),
 * });
 *
 * server.start();
 * ```
 */

import type { Server } from 'bun';
import type { ClaudeServerConfig, ActiveProcess } from './types';
import {
  findClaudePath,
  spawnClaude,
  parseClaudeStream,
  parseStderr,
  type StreamCallbacks,
} from './claude';
import {
  createWebSocketHandler,
  startPeriodicTasks,
  stopPeriodicTasks,
  resetChatState,
  broadcastToken,
  broadcastToolStart,
  broadcastToolEnd,
  broadcastTodoUpdate,
  broadcastThinking,
  broadcastComplete,
  broadcastError,
  subscribeToSession,
  type ClaudeWebSocket,
} from './websocket';

// Re-export types for consumers
export type {
  ClaudeServerConfig,
  WebSocketMessage,
  ChatPayload,
  SystemPayload,
  ChatState,
  ToolUseData,
  TodoItem,
} from './types';

// =============================================================================
// Server State
// =============================================================================

/** Active Claude processes by session ID */
const activeProcesses = new Map<string, ActiveProcess>();

// =============================================================================
// Chat Handler
// =============================================================================

/**
 * Handle a chat message from a client.
 */
async function handleChat(
  ws: ClaudeWebSocket,
  sessionId: string | undefined,
  content: string,
  config: Required<ClaudeServerConfig>
): Promise<void> {
  // Generate session ID if not resuming
  const effectiveSessionId = sessionId || `new-${Date.now()}`;

  // Subscribe client to this session
  subscribeToSession(ws, effectiveSessionId);

  // Reset chat state for new message
  resetChatState(effectiveSessionId);

  // Check for existing process
  const existing = activeProcesses.get(effectiveSessionId);
  if (existing && !existing.aborted) {
    broadcastError(effectiveSessionId, 'A request is already in progress');
    return;
  }

  // Spawn Claude
  const { proc, reader } = spawnClaude({
    prompt: content,
    projectPath: config.projectPath,
    claudePath: config.claudePath,
    sessionId: sessionId, // Only pass if resuming
  });

  // Track process
  const processInfo: ActiveProcess = {
    proc,
    sessionId: effectiveSessionId,
    aborted: false,
    startedAt: Date.now(),
  };
  activeProcesses.set(effectiveSessionId, processInfo);

  config.onStreamStart?.(effectiveSessionId);

  // Set up callbacks
  let detectedSessionId = effectiveSessionId;

  const callbacks: StreamCallbacks = {
    onInit: (sid) => {
      detectedSessionId = sid;
      // Update process tracking with real session ID
      if (sid !== effectiveSessionId) {
        activeProcesses.delete(effectiveSessionId);
        processInfo.sessionId = sid;
        activeProcesses.set(sid, processInfo);
        // Re-subscribe client to correct session
        subscribeToSession(ws, sid);
        resetChatState(sid);
      }
    },

    onText: (text) => {
      broadcastToken(detectedSessionId, text);
    },

    onToolStart: (tool) => {
      broadcastToolStart(detectedSessionId, tool);
    },

    onToolEnd: (tool) => {
      broadcastToolEnd(detectedSessionId, tool);
    },

    onTodoUpdate: (todos) => {
      broadcastTodoUpdate(detectedSessionId, todos);
    },

    onThinking: (message) => {
      broadcastThinking(detectedSessionId, message);
    },

    onComplete: (result) => {
      broadcastComplete(detectedSessionId, result);
    },

    onError: (error) => {
      broadcastError(detectedSessionId, error);
    },
  };

  // Set up thinking timeout (emit if no output for 8 seconds)
  let lastEventTime = Date.now();
  let thinkingTimeout: ReturnType<typeof setTimeout> | null = null;

  const startThinkingCheck = () => {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    thinkingTimeout = setTimeout(() => {
      const elapsed = Date.now() - lastEventTime;
      if (elapsed >= 8000 && !processInfo.aborted) {
        broadcastThinking(detectedSessionId, 'Processing...');
        startThinkingCheck();
      }
    }, 8000);
  };

  startThinkingCheck();

  // Wrap callbacks to update lastEventTime
  const wrappedCallbacks: StreamCallbacks = {
    ...callbacks,
    onText: (text) => {
      lastEventTime = Date.now();
      callbacks.onText(text);
    },
    onToolStart: (tool) => {
      lastEventTime = Date.now();
      callbacks.onToolStart(tool);
    },
    onToolEnd: (tool) => {
      lastEventTime = Date.now();
      callbacks.onToolEnd(tool);
    },
  };

  try {
    // Parse the stream
    await parseClaudeStream(
      reader,
      wrappedCallbacks,
      () => processInfo.aborted
    );

    // Wait for process to exit
    const exitCode = await proc.exited;

    if (thinkingTimeout) clearTimeout(thinkingTimeout);

    if (exitCode !== 0 && !processInfo.aborted) {
      const errorMessage = await parseStderr(proc.stderr);
      broadcastError(detectedSessionId, errorMessage);
    } else if (!processInfo.aborted) {
      // Ensure completion is sent
      broadcastComplete(detectedSessionId);
    }
  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    broadcastError(
      detectedSessionId,
      error instanceof Error ? error.message : 'Unknown error'
    );
  } finally {
    activeProcesses.delete(detectedSessionId);
    config.onStreamEnd?.(detectedSessionId);
  }
}

/**
 * Handle cancel request.
 */
function handleCancel(sessionId: string): void {
  const processInfo = activeProcesses.get(sessionId);
  if (processInfo && !processInfo.aborted) {
    processInfo.aborted = true;
    processInfo.proc.kill();
    broadcastError(sessionId, 'Request cancelled');
    console.log(`[Claude] Cancelled session ${sessionId.substring(0, 8)}`);
  }
}

// =============================================================================
// Server Factory
// =============================================================================

export interface ClaudeServer {
  /** Start the server */
  start: () => void;
  /** Stop the server */
  stop: () => void;
  /** The underlying Bun server (available after start) */
  server: Server | null;
}

/**
 * Create a Claude chat server.
 */
export function createClaudeServer(
  config: ClaudeServerConfig = {}
): ClaudeServer {
  // Resolve configuration
  const resolvedConfig: Required<ClaudeServerConfig> = {
    port: config.port ?? 3000,
    projectPath: config.projectPath ?? process.cwd(),
    claudePath: config.claudePath ?? findClaudePath() ?? 'claude',
    onConnect: config.onConnect ?? (() => {}),
    onDisconnect: config.onDisconnect ?? (() => {}),
    onStreamStart: config.onStreamStart ?? (() => {}),
    onStreamEnd: config.onStreamEnd ?? (() => {}),
  };

  let server: Server | null = null;

  // Create WebSocket handler
  const wsHandler = createWebSocketHandler(
    (ws, sessionId, content) => handleChat(ws, sessionId, content, resolvedConfig),
    handleCancel
  );

  return {
    start() {
      // Start periodic tasks
      startPeriodicTasks();

      // Start the server
      server = Bun.serve({
        port: resolvedConfig.port,

        fetch(req, server) {
          const url = new URL(req.url);

          // WebSocket upgrade
          if (url.pathname === '/ws' || req.headers.get('upgrade') === 'websocket') {
            const success = server.upgrade(req, {
              data: {
                clientId: '',
                connectedAt: new Date(),
                lastPing: new Date(),
                lastSeq: 0,
              },
            });

            if (success) {
              return undefined;
            }

            return new Response('WebSocket upgrade failed', { status: 500 });
          }

          // Health check
          if (url.pathname === '/health') {
            return new Response(
              JSON.stringify({
                ok: true,
                clients: 0, // Could expose getClientCount()
                uptime: process.uptime(),
              }),
              {
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }

          // CORS preflight
          if (req.method === 'OPTIONS') {
            return new Response(null, {
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
              },
            });
          }

          return new Response('Not Found', { status: 404 });
        },

        websocket: wsHandler,
      });

      console.log(`[Claude Chat] Server running on ws://localhost:${resolvedConfig.port}/ws`);
      console.log(`[Claude Chat] Project path: ${resolvedConfig.projectPath}`);
      console.log(`[Claude Chat] Claude CLI: ${resolvedConfig.claudePath}`);
    },

    stop() {
      stopPeriodicTasks();
      if (server) {
        server.stop();
        server = null;
      }
      console.log('[Claude Chat] Server stopped');
    },

    get server() {
      return server;
    },
  };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

// If run directly, start the server
if (import.meta.main) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const projectPath = process.env.PROJECT_PATH || process.cwd();

  const server = createClaudeServer({
    port,
    projectPath,
  });

  server.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });
}
