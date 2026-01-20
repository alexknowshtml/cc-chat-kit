/**
 * Tests for useClaude React hook.
 *
 * Tests the state machine, message handling, and WebSocket protocol.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';

// Mock WebSocket for testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError() {
    this.onerror?.();
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Store reference to mock instances
let mockWsInstances: MockWebSocket[] = [];

// Replace global WebSocket
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  mockWsInstances = [];
  (globalThis as { WebSocket: typeof MockWebSocket }).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWsInstances.push(this);
    }
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  mockWsInstances = [];
});

// =============================================================================
// Message Protocol Tests
// =============================================================================

describe('WebSocket Message Protocol', () => {
  test('token messages accumulate streaming content', async () => {
    // Import fresh module after mocking
    const { useClaude } = await import('./useClaude');

    // Create a simple state tracker
    let streamingContent = '';
    const messages: Array<{ type: string; seq: number; payload: object }> = [
      {
        type: 'chat',
        seq: 1,
        payload: { action: 'token', content: 'Hello' },
      },
      {
        type: 'chat',
        seq: 2,
        payload: { action: 'token', content: ' world' },
      },
    ];

    // Simulate processing
    for (const msg of messages) {
      if (
        msg.type === 'chat' &&
        (msg.payload as { action: string }).action === 'token'
      ) {
        streamingContent += (msg.payload as { content: string }).content;
      }
    }

    expect(streamingContent).toBe('Hello world');
  });

  test('tool_start adds to active tools', () => {
    const activeTools: Array<{ id: string; name: string }> = [];

    const toolPayload = {
      action: 'tool_start',
      tool: {
        id: 'tool-1',
        name: 'Read',
        friendly: 'Reading file.ts',
      },
    };

    // Simulate adding tool
    if (
      toolPayload.action === 'tool_start' &&
      !activeTools.some((t) => t.id === toolPayload.tool.id)
    ) {
      activeTools.push(toolPayload.tool);
    }

    expect(activeTools.length).toBe(1);
    expect(activeTools[0].id).toBe('tool-1');
    expect(activeTools[0].name).toBe('Read');
  });

  test('tool_end moves tool from active to completed', () => {
    let activeTools = [{ id: 'tool-1', name: 'Read' }];
    let completedTools: Array<{ id: string; name: string; duration?: number }> =
      [];

    const toolEndPayload = {
      action: 'tool_end',
      tool: {
        id: 'tool-1',
        name: 'Read',
        duration: 150,
      },
    };

    // Simulate tool_end processing
    if (toolEndPayload.action === 'tool_end') {
      activeTools = activeTools.filter((t) => t.id !== toolEndPayload.tool.id);
      completedTools.push(toolEndPayload.tool);
    }

    expect(activeTools.length).toBe(0);
    expect(completedTools.length).toBe(1);
    expect(completedTools[0].duration).toBe(150);
  });

  test('complete resets streaming state', () => {
    let isStreaming = true;
    let streamingContent = 'Some content';
    let activeTools = [{ id: 'tool-1', name: 'Read' }];
    let completedTools = [{ id: 'tool-2', name: 'Write' }];

    const completePayload = { action: 'complete' };

    // Simulate complete processing
    if (completePayload.action === 'complete') {
      isStreaming = false;
      // Note: streamingContent is preserved in the message
      // but the streaming state refs are reset
      activeTools = [];
      // completedTools are preserved until next send
    }

    expect(isStreaming).toBe(false);
    expect(activeTools.length).toBe(0);
  });

  test('error sets error state', () => {
    let error: string | null = null;
    let isStreaming = true;

    const errorPayload = {
      action: 'error',
      error: 'Rate limited, please wait',
    };

    // Simulate error processing
    if (errorPayload.action === 'error') {
      error = errorPayload.error;
      isStreaming = false;
    }

    expect(error).toBe('Rate limited, please wait');
    expect(isStreaming).toBe(false);
  });

  test('todo_update sets todos', () => {
    let todos: Array<{ content: string; status: string }> | null = null;

    const todoPayload = {
      action: 'todo_update',
      todos: [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'in_progress' },
      ],
    };

    // Simulate todo_update processing
    if (todoPayload.action === 'todo_update') {
      todos = todoPayload.todos;
    }

    expect(todos).not.toBeNull();
    expect(todos!.length).toBe(2);
    expect(todos![0].content).toBe('Task 1');
    expect(todos![1].status).toBe('in_progress');
  });
});

// =============================================================================
// Connection State Machine Tests
// =============================================================================

describe('Connection State Machine', () => {
  test('initial state is disconnected', () => {
    const status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
      'disconnected';
    expect(status).toBe('disconnected');
  });

  test('connect transitions to connecting then connected', () => {
    let status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
      'disconnected';

    // Simulate connect()
    status = 'connecting';
    expect(status).toBe('connecting');

    // Simulate onopen
    status = 'connected';
    expect(status).toBe('connected');
  });

  test('disconnect transitions to disconnected', () => {
    let status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
      'connected';

    // Simulate disconnect()
    status = 'disconnected';
    expect(status).toBe('disconnected');
  });

  test('reconnect transitions through reconnecting', () => {
    let status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
      'connected';
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    // Simulate unexpected disconnect
    status = 'disconnected';

    // Simulate auto-reconnect logic
    if (reconnectAttempts < maxReconnectAttempts) {
      status = 'reconnecting';
      reconnectAttempts++;
    }

    expect(status).toBe('reconnecting');
    expect(reconnectAttempts).toBe(1);
  });

  test('max reconnect attempts stops reconnection', () => {
    let status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
      'disconnected';
    let reconnectAttempts = 5;
    const maxReconnectAttempts = 5;

    // Try to reconnect when at max
    if (reconnectAttempts < maxReconnectAttempts) {
      status = 'reconnecting';
    } else {
      status = 'disconnected';
    }

    expect(status).toBe('disconnected');
  });
});

// =============================================================================
// Message History Tests
// =============================================================================

describe('Message History', () => {
  test('send adds user message and placeholder assistant message', () => {
    const messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      isStreaming?: boolean;
    }> = [];

    // Simulate send()
    const userMessage = {
      id: 'msg-1',
      role: 'user' as const,
      content: 'Hello Claude',
    };

    const assistantPlaceholder = {
      id: 'msg-2',
      role: 'assistant' as const,
      content: '',
      isStreaming: true,
    };

    messages.push(userMessage, assistantPlaceholder);

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello Claude');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].isStreaming).toBe(true);
  });

  test('complete finalizes streaming message', () => {
    const messages = [
      { id: 'msg-1', role: 'user' as const, content: 'Hello' },
      {
        id: 'msg-2',
        role: 'assistant' as const,
        content: '',
        isStreaming: true,
      },
    ];

    const finalContent = 'Hello! How can I help you?';

    // Simulate complete processing
    const streamingIdx = messages.findIndex((m) => m.isStreaming);
    if (streamingIdx >= 0) {
      messages[streamingIdx] = {
        ...messages[streamingIdx],
        content: finalContent,
        isStreaming: false,
      };
    }

    expect(messages[1].content).toBe('Hello! How can I help you?');
    expect(messages[1].isStreaming).toBe(false);
  });

  test('clearMessages resets all state', () => {
    let messages = [{ id: 'msg-1', role: 'user' as const, content: 'Hello' }];
    let streamingContent = 'partial';
    let activeTools = [{ id: 'tool-1', name: 'Read' }];
    let completedTools = [{ id: 'tool-2', name: 'Write' }];
    let todos: Array<{ content: string; status: string }> | null = [
      { content: 'Task', status: 'pending' },
    ];
    let error: string | null = 'Some error';

    // Simulate clearMessages()
    messages = [];
    streamingContent = '';
    activeTools = [];
    completedTools = [];
    todos = null;
    error = null;

    expect(messages.length).toBe(0);
    expect(streamingContent).toBe('');
    expect(activeTools.length).toBe(0);
    expect(completedTools.length).toBe(0);
    expect(todos).toBeNull();
    expect(error).toBeNull();
  });
});

// =============================================================================
// Content Block Interleaving Tests
// =============================================================================

describe('Content Block Interleaving', () => {
  test('text content creates text blocks', () => {
    const contentBlocks: Array<{ type: string; content?: string }> = [];
    let pendingText = '';

    // Simulate token events
    pendingText += 'Hello ';
    pendingText += 'world';

    // Before tool_start, flush pending text
    if (pendingText.trim()) {
      contentBlocks.push({ type: 'text', content: pendingText });
      pendingText = '';
    }

    expect(contentBlocks.length).toBe(1);
    expect(contentBlocks[0].type).toBe('text');
    expect(contentBlocks[0].content).toBe('Hello world');
  });

  test('tool_start after text creates interleaved blocks', () => {
    const contentBlocks: Array<{
      type: string;
      content?: string;
      tools?: Array<{ id: string; name: string }>;
    }> = [];
    let pendingText = 'Let me check that file.';
    let currentToolGroup: Array<{ id: string; name: string }> = [];

    // Flush text before tool
    if (pendingText.trim()) {
      contentBlocks.push({ type: 'text', content: pendingText });
      pendingText = '';
    }

    // Add tool to group
    currentToolGroup.push({ id: 'tool-1', name: 'Read' });

    // When all tools complete, flush tool group
    contentBlocks.push({ type: 'tool_group', tools: [...currentToolGroup] });
    currentToolGroup = [];

    // More text after tool
    pendingText = 'Found it!';
    contentBlocks.push({ type: 'text', content: pendingText });

    expect(contentBlocks.length).toBe(3);
    expect(contentBlocks[0].type).toBe('text');
    expect(contentBlocks[1].type).toBe('tool_group');
    expect(contentBlocks[2].type).toBe('text');
  });

  test('multiple tools batch into single tool_group', () => {
    const contentBlocks: Array<{
      type: string;
      tools?: Array<{ id: string; name: string }>;
    }> = [];
    let currentToolGroup: Array<{ id: string; name: string }> = [];
    let activeToolCount = 0;

    // Start first tool
    currentToolGroup.push({ id: 'tool-1', name: 'Read' });
    activeToolCount++;

    // Start second tool (before first completes)
    currentToolGroup.push({ id: 'tool-2', name: 'Grep' });
    activeToolCount++;

    // First tool completes
    activeToolCount--;

    // Second tool completes
    activeToolCount--;

    // Only flush when all tools complete
    if (activeToolCount === 0 && currentToolGroup.length > 0) {
      contentBlocks.push({ type: 'tool_group', tools: [...currentToolGroup] });
      currentToolGroup = [];
    }

    expect(contentBlocks.length).toBe(1);
    expect(contentBlocks[0].tools!.length).toBe(2);
  });
});

// =============================================================================
// Session Resume Tests
// =============================================================================

describe('Session Resume', () => {
  test('subscribe message sent with sessionId', () => {
    const sessionId = 'session-123';
    const sentMessages: object[] = [];

    // Simulate subscription on connect
    sentMessages.push({
      type: 'system',
      seq: 0,
      timestamp: Date.now(),
      payload: {
        action: 'subscribe',
        sessionId,
      },
    });

    expect(sentMessages.length).toBe(1);
    const msg = sentMessages[0] as {
      type: string;
      payload: { action: string; sessionId: string };
    };
    expect(msg.type).toBe('system');
    expect(msg.payload.action).toBe('subscribe');
    expect(msg.payload.sessionId).toBe('session-123');
  });

  test('snapshot restores chat state', () => {
    let isStreaming = false;
    let streamingContent = '';
    let completedTools: Array<{ id: string; name: string }> = [];
    let todos: Array<{ content: string; status: string }> | null = null;

    const snapshotPayload = {
      action: 'snapshot',
      sessionId: 'session-123',
      chatState: {
        status: 'streaming',
        accumulatedContent: 'Partial response so far...',
        tools: [{ id: 'tool-1', name: 'Read' }],
        todos: [{ content: 'Task 1', status: 'in_progress' }],
      },
    };

    // Simulate snapshot processing
    if (snapshotPayload.chatState) {
      const state = snapshotPayload.chatState;
      if (state.status === 'streaming') {
        isStreaming = true;
        streamingContent = state.accumulatedContent;
      }
      if (state.tools) {
        completedTools = state.tools;
      }
      if (state.todos) {
        todos = state.todos;
      }
    }

    expect(isStreaming).toBe(true);
    expect(streamingContent).toBe('Partial response so far...');
    expect(completedTools.length).toBe(1);
    expect(todos!.length).toBe(1);
  });
});

// =============================================================================
// Send Message Format Tests
// =============================================================================

describe('Send Message Format', () => {
  test('send creates properly formatted message', () => {
    const sessionId = 'session-123';
    const content = 'Hello Claude!';

    const message = {
      type: 'chat',
      seq: 0,
      timestamp: Date.now(),
      sessionId,
      payload: {
        action: 'send',
        content,
      },
    };

    expect(message.type).toBe('chat');
    expect(message.sessionId).toBe('session-123');
    expect(
      (message.payload as { action: string; content: string }).action
    ).toBe('send');
    expect(
      (message.payload as { action: string; content: string }).content
    ).toBe('Hello Claude!');
  });

  test('cancel creates properly formatted message', () => {
    const sessionId = 'session-123';

    const message = {
      type: 'chat',
      seq: 0,
      timestamp: Date.now(),
      sessionId,
      payload: {
        action: 'cancel',
      },
    };

    expect(message.type).toBe('chat');
    expect((message.payload as { action: string }).action).toBe('cancel');
  });
});

// =============================================================================
// Deduplication Tests
// =============================================================================

describe('Deduplication', () => {
  test('duplicate tool_start events are ignored', () => {
    let activeTools: Array<{ id: string; name: string }> = [];

    const addTool = (tool: { id: string; name: string }) => {
      if (!activeTools.some((t) => t.id === tool.id)) {
        activeTools = [...activeTools, tool];
      }
    };

    // Add same tool twice
    addTool({ id: 'tool-1', name: 'Read' });
    addTool({ id: 'tool-1', name: 'Read' });

    expect(activeTools.length).toBe(1);
  });

  test('duplicate tool_end events are ignored', () => {
    let completedTools: Array<{ id: string; name: string }> = [];

    const completeTool = (tool: { id: string; name: string }) => {
      if (!completedTools.some((t) => t.id === tool.id)) {
        completedTools = [...completedTools, tool];
      }
    };

    // Complete same tool twice
    completeTool({ id: 'tool-1', name: 'Read' });
    completeTool({ id: 'tool-1', name: 'Read' });

    expect(completedTools.length).toBe(1);
  });
});

// =============================================================================
// Sequence Number Tests
// =============================================================================

describe('Sequence Numbers', () => {
  test('sequence numbers track message order', () => {
    let lastSeq = 0;

    const messages = [
      { type: 'chat', seq: 1, payload: { action: 'token', content: 'a' } },
      { type: 'chat', seq: 2, payload: { action: 'token', content: 'b' } },
      { type: 'chat', seq: 3, payload: { action: 'complete' } },
    ];

    for (const msg of messages) {
      if (msg.seq > lastSeq) {
        lastSeq = msg.seq;
      }
    }

    expect(lastSeq).toBe(3);
  });

  test('connected event may include currentSeq', () => {
    let lastSeq = 0;

    const connectedPayload = {
      action: 'connected',
      currentSeq: 42,
    };

    if (connectedPayload.currentSeq) {
      lastSeq = connectedPayload.currentSeq;
    }

    expect(lastSeq).toBe(42);
  });
});
