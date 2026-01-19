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
  ContentBlock,
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
  // Use refs to avoid stale closures in handleMessage
  const streamingContentRef = useRef('');
  const completedToolsRef = useRef<ToolUseData[]>([]);
  const isStreamingRef = useRef(false);
  // Track content blocks for interleaved rendering
  const contentBlocksRef = useRef<ContentBlock[]>([]);
  const pendingTextRef = useRef('');
  const currentToolGroupRef = useRef<ToolUseData[]>([]);

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
              // Accumulate text content
              pendingTextRef.current += payload.content;
              setStreamingContent((prev) => {
                const newContent = prev + payload.content;
                streamingContentRef.current = newContent;
                return newContent;
              });
            }
            break;

          case 'tool_start':
            if (payload.tool) {
              // If we have pending text, flush it as a text block before starting tools
              if (pendingTextRef.current.trim()) {
                contentBlocksRef.current = [
                  ...contentBlocksRef.current,
                  { type: 'text', content: pendingTextRef.current, timestamp: Date.now() },
                ];
                pendingTextRef.current = '';
              }

              // Add tool to current tool group
              if (!currentToolGroupRef.current.some((t) => t.id === payload.tool!.id)) {
                currentToolGroupRef.current = [...currentToolGroupRef.current, payload.tool!];
              }

              setActiveTools((prev) => {
                // Deduplicate - don't add if tool with this ID already exists
                if (prev.some((t) => t.id === payload.tool!.id)) {
                  return prev;
                }
                return [...prev, payload.tool!];
              });
            }
            break;

          case 'tool_end':
            if (payload.tool) {
              // Update the tool in current tool group with completion data
              currentToolGroupRef.current = currentToolGroupRef.current.map((t) =>
                t.id === payload.tool!.id ? { ...t, ...payload.tool } : t
              );

              setActiveTools((prev) => {
                const filtered = prev.filter((t) => t.id !== payload.tool!.id);

                // If no more active tools, flush the tool group as a content block
                if (filtered.length === 0 && currentToolGroupRef.current.length > 0) {
                  contentBlocksRef.current = [
                    ...contentBlocksRef.current,
                    { type: 'tool_group', tools: [...currentToolGroupRef.current], timestamp: Date.now() },
                  ];
                  currentToolGroupRef.current = [];
                }

                return filtered;
              });

              setCompletedTools((prev) => {
                // Deduplicate - don't add if tool with this ID already exists
                if (prev.some((t) => t.id === payload.tool!.id)) {
                  return prev;
                }
                const newTools = [...prev, payload.tool!];
                completedToolsRef.current = newTools;
                return newTools;
              });
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
            isStreamingRef.current = false;

            // Flush any remaining pending text as a final content block
            if (pendingTextRef.current.trim()) {
              contentBlocksRef.current = [
                ...contentBlocksRef.current,
                { type: 'text', content: pendingTextRef.current, timestamp: Date.now() },
              ];
              pendingTextRef.current = '';
            }

            // Flush any remaining tool group (shouldn't happen, but be safe)
            if (currentToolGroupRef.current.length > 0) {
              contentBlocksRef.current = [
                ...contentBlocksRef.current,
                { type: 'tool_group', tools: [...currentToolGroupRef.current], timestamp: Date.now() },
              ];
              currentToolGroupRef.current = [];
            }

            // Use refs to get current values (avoids stale closure)
            const finalContent = streamingContentRef.current;
            const finalTools = [...completedToolsRef.current];
            const finalContentBlocks = [...contentBlocksRef.current];
            const currentMsgId = currentAssistantMessageRef.current;

            setMessages((prev) => {
              // Find the streaming message by ID first, fallback to finding any streaming message
              let streamingIdx = prev.findIndex((m) => m.id === currentMsgId);

              // Fallback: find any message that's still streaming
              if (streamingIdx < 0) {
                streamingIdx = prev.findIndex((m) => m.isStreaming);
              }

              if (streamingIdx >= 0) {
                const updated = [...prev];
                updated[streamingIdx] = {
                  ...updated[streamingIdx],
                  content: finalContent,
                  tools: finalTools,
                  contentBlocks: finalContentBlocks,
                  isStreaming: false,
                };
                return updated;
              }

              // Only add a new message if we truly don't have one
              // This should rarely happen
              if (finalContent || finalTools.length > 0 || finalContentBlocks.length > 0) {
                return [
                  ...prev,
                  {
                    id: generateId(),
                    role: 'assistant' as const,
                    content: finalContent,
                    timestamp: Date.now(),
                    tools: finalTools,
                    contentBlocks: finalContentBlocks,
                    isStreaming: false,
                  },
                ];
              }

              return prev;
            });

            // Reset streaming state
            setStreamingContent('');
            streamingContentRef.current = '';
            setActiveTools([]);
            setCompletedTools([]);
            completedToolsRef.current = [];
            contentBlocksRef.current = [];
            pendingTextRef.current = '';
            currentToolGroupRef.current = [];
            currentAssistantMessageRef.current = null;
            break;

          case 'error':
            setIsStreaming(false);
            isStreamingRef.current = false;
            setError(payload.error || 'Unknown error');
            onError?.(payload.error || 'Unknown error');

            // Reset streaming state
            setStreamingContent('');
            streamingContentRef.current = '';
            setActiveTools([]);
            setCompletedTools([]);
            completedToolsRef.current = [];
            contentBlocksRef.current = [];
            pendingTextRef.current = '';
            currentToolGroupRef.current = [];
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
                isStreamingRef.current = true;
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
  }, [onError]);

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

    // Only close if we're actually connected or connecting
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect
      wsRef.current.close();
      wsRef.current = null;
      setStatus('disconnected');
    }
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

      // Prevent double-send while already streaming
      if (isStreamingRef.current) {
        return;
      }

      // Add user message to history
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      // Prepare for streaming response
      setIsStreaming(true);
      isStreamingRef.current = true;
      setStreamingContent('');
      streamingContentRef.current = '';
      setActiveTools([]);
      setCompletedTools([]);
      completedToolsRef.current = [];
      setError(null);

      // Create placeholder assistant message
      const assistantId = generateId();
      currentAssistantMessageRef.current = assistantId;

      // Add both user and assistant messages in one update to avoid race conditions
      setMessages((prev) => [
        ...prev,
        userMessage,
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

  // Auto-connect on mount (only run once)
  // Note: We don't disconnect on unmount because React StrictMode double-mounts
  // and would immediately disconnect the connection we just made
  useEffect(() => {
    if (autoConnect && !wsRef.current) {
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update streaming message content in real-time
  useEffect(() => {
    if (isStreaming && currentAssistantMessageRef.current) {
      setMessages((prev) => {
        const idx = prev.findIndex(
          (m) => m.id === currentAssistantMessageRef.current
        );
        if (idx >= 0) {
          const updated = [...prev];
          // Build live contentBlocks from refs for real-time rendering
          const liveContentBlocks = [...contentBlocksRef.current];
          // Add pending text if any
          if (pendingTextRef.current.trim()) {
            liveContentBlocks.push({
              type: 'text',
              content: pendingTextRef.current,
              timestamp: Date.now(),
            });
          }
          // Add current tool group if any active tools
          if (currentToolGroupRef.current.length > 0) {
            liveContentBlocks.push({
              type: 'tool_group',
              tools: [...currentToolGroupRef.current],
              timestamp: Date.now(),
            });
          }
          updated[idx] = {
            ...updated[idx],
            content: streamingContent,
            tools: [...activeTools, ...completedTools],
            contentBlocks: liveContentBlocks,
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
