/**
 * useClaude React Hook
 *
 * A React hook for connecting to and interacting with a Claude chat server.
 *
 * Usage:
 * ```tsx
 * import { useClaude } from '@anthropic/claude-chat-react';
 *
 * function Chat() {
 *   const {
 *     messages,
 *     streamingContent,
 *     isStreaming,
 *     send,
 *     cancel,
 *   } = useClaude({ url: 'ws://localhost:3000/ws' });
 *
 *   return (
 *     <div>
 *       {messages.map(m => <Message key={m.id} {...m} />)}
 *       {isStreaming && <div>{streamingContent}</div>}
 *       <input onSubmit={(e) => send(e.target.value)} />
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  UseClaudeOptions,
  UseClaudeReturn,
  ConnectionStatus,
  ChatMessage,
  ToolUseData,
  TodoItem,
  WebSocketMessage,
  ChatPayload,
  SystemPayload,
} from './types';

/**
 * Generate a unique message ID.
 */
function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * React hook for Claude chat integration.
 */
export function useClaude(options: UseClaudeOptions): UseClaudeReturn {
  const {
    url,
    sessionId: initialSessionId,
    autoConnect = true,
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = 2000,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  // Connection state
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeTools, setActiveTools] = useState<ToolUseData[]>([]);
  const [completedTools, setCompletedTools] = useState<ToolUseData[]>([]);
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeqRef = useRef(0);
  const currentAssistantMessageRef = useRef<string | null>(null);

  /**
   * Handle incoming WebSocket message.
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data) as WebSocketMessage;

      // Update sequence tracking
      if (msg.seq > lastSeqRef.current) {
        lastSeqRef.current = msg.seq;
      }

      if (msg.type === 'chat') {
        const payload = msg.payload as ChatPayload;

        switch (payload.action) {
          case 'token':
            if (payload.content) {
              setStreamingContent((prev) => prev + payload.content);
            }
            break;

          case 'tool_start':
            if (payload.tool) {
              setActiveTools((prev) => [...prev, payload.tool!]);
            }
            break;

          case 'tool_end':
            if (payload.tool) {
              setActiveTools((prev) =>
                prev.filter((t) => t.id !== payload.tool!.id)
              );
              setCompletedTools((prev) => [...prev, payload.tool!]);
            }
            break;

          case 'todo_update':
            if (payload.todos) {
              setTodos(payload.todos);
            }
            break;

          case 'thinking':
            // Could show a thinking indicator
            break;

          case 'complete':
            // Finalize the assistant message
            setIsStreaming(false);
            setMessages((prev) => {
              // Find and update the streaming message, or add new one
              const streamingIdx = prev.findIndex(
                (m) => m.id === currentAssistantMessageRef.current
              );

              if (streamingIdx >= 0) {
                const updated = [...prev];
                updated[streamingIdx] = {
                  ...updated[streamingIdx],
                  content: streamingContent + (payload.content || ''),
                  tools: [...completedTools],
                  isStreaming: false,
                };
                return updated;
              }

              // Add new message if not found
              if (streamingContent || completedTools.length > 0) {
                return [
                  ...prev,
                  {
                    id: generateId(),
                    role: 'assistant' as const,
                    content: streamingContent + (payload.content || ''),
                    timestamp: Date.now(),
                    tools: [...completedTools],
                    isStreaming: false,
                  },
                ];
              }

              return prev;
            });

            // Reset streaming state
            setStreamingContent('');
            setActiveTools([]);
            setCompletedTools([]);
            currentAssistantMessageRef.current = null;
            break;

          case 'error':
            setIsStreaming(false);
            setError(payload.error || 'Unknown error');
            onError?.(payload.error || 'Unknown error');

            // Reset streaming state
            setStreamingContent('');
            setActiveTools([]);
            setCompletedTools([]);
            currentAssistantMessageRef.current = null;
            break;
        }
      } else if (msg.type === 'system') {
        const payload = msg.payload as SystemPayload;

        switch (payload.action) {
          case 'connected':
            // Connection established
            if (payload.currentSeq) {
              lastSeqRef.current = payload.currentSeq;
            }
            break;

          case 'snapshot':
            // Catch-up data received
            if (payload.sessionId) {
              setSessionId(payload.sessionId);
            }

            // Replay any missed events
            if (payload.events) {
              for (const event of payload.events) {
                handleMessage({ data: JSON.stringify(event) } as MessageEvent);
              }
            }

            // Restore chat state
            if (payload.chatState) {
              const state = payload.chatState;
              if (state.status === 'streaming') {
                setIsStreaming(true);
                setStreamingContent(state.accumulatedContent);
              }
              if (state.tools) {
                setCompletedTools(state.tools);
              }
              if (state.todos) {
                setTodos(state.todos);
              }
            }
            break;

          case 'error':
            setError(payload.error || 'System error');
            onError?.(payload.error || 'System error');
            break;
        }
      }
    } catch (err) {
      console.error('[useClaude] Failed to parse message:', err);
    }
  }, [streamingContent, completedTools, onError]);

  /**
   * Connect to the WebSocket server.
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');
    setError(null);

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('connected');
      reconnectAttemptsRef.current = 0;
      onConnect?.();

      // Subscribe to session if we have one
      if (sessionId) {
        ws.send(
          JSON.stringify({
            type: 'system',
            seq: 0,
            timestamp: Date.now(),
            payload: {
              action: 'subscribe',
              sessionId,
            },
          })
        );
      }
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      onDisconnect?.();

      // Attempt reconnect
      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        setStatus('reconnecting');
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect();
        }, reconnectDelay * Math.pow(2, reconnectAttemptsRef.current));
      }
    };

    ws.onerror = () => {
      setError('Connection error');
    };

    wsRef.current = ws;
  }, [
    url,
    sessionId,
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
    onConnect,
    onDisconnect,
    handleMessage,
  ]);

  /**
   * Disconnect from the WebSocket server.
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('disconnected');
  }, [maxReconnectAttempts]);

  /**
   * Send a message to Claude.
   */
  const send = useCallback(
    (content: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setError('Not connected');
        return;
      }

      // Add user message to history
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Prepare for streaming response
      setIsStreaming(true);
      setStreamingContent('');
      setActiveTools([]);
      setCompletedTools([]);
      setError(null);

      // Create placeholder assistant message
      const assistantId = generateId();
      currentAssistantMessageRef.current = assistantId;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]);

      // Send the message
      wsRef.current.send(
        JSON.stringify({
          type: 'chat',
          seq: 0,
          timestamp: Date.now(),
          sessionId,
          payload: {
            action: 'send',
            content,
          },
        })
      );
    },
    [sessionId]
  );

  /**
   * Cancel the current streaming response.
   */
  const cancel = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: 'chat',
        seq: 0,
        timestamp: Date.now(),
        sessionId,
        payload: {
          action: 'cancel',
        },
      })
    );
  }, [sessionId]);

  /**
   * Clear chat history.
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingContent('');
    setActiveTools([]);
    setCompletedTools([]);
    setTodos(null);
    setError(null);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Update streaming message content in real-time
  useEffect(() => {
    if (isStreaming && currentAssistantMessageRef.current) {
      setMessages((prev) => {
        const idx = prev.findIndex(
          (m) => m.id === currentAssistantMessageRef.current
        );
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            content: streamingContent,
            tools: [...activeTools, ...completedTools],
          };
          return updated;
        }
        return prev;
      });
    }
  }, [streamingContent, activeTools, completedTools, isStreaming]);

  return {
    status,
    sessionId,
    messages,
    streamingContent,
    activeTools,
    completedTools,
    todos,
    isStreaming,
    error,
    send,
    cancel,
    connect,
    disconnect,
    clearMessages,
  };
}
