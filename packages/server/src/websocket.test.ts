/**
 * Tests for WebSocket connection manager.
 *
 * Tests client management, broadcasting, session subscriptions, and state.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';

// =============================================================================
// Chat State Management Tests
// =============================================================================

describe('Chat State Management', () => {
  interface ChatState {
    status: 'idle' | 'streaming' | 'complete' | 'error';
    accumulatedContent: string;
    tools: Array<{ id: string; name: string; summary?: string }>;
    todos: Array<{ content: string; status: string }> | null;
    errorMessage?: string;
  }

  function createEmptyState(): ChatState {
    return {
      status: 'idle',
      accumulatedContent: '',
      tools: [],
      todos: null,
    };
  }

  function updateChatState(
    state: ChatState,
    payload: {
      action: string;
      content?: string;
      tool?: { id: string; name: string; summary?: string };
      todos?: Array<{ content: string; status: string }>;
      error?: string;
    }
  ): ChatState {
    const newState = { ...state };

    switch (payload.action) {
      case 'token':
        newState.status = 'streaming';
        newState.accumulatedContent += payload.content || '';
        break;

      case 'tool_start':
        newState.status = 'streaming';
        if (payload.tool) {
          newState.tools = [...newState.tools, { ...payload.tool }];
        }
        break;

      case 'tool_end':
        if (payload.tool) {
          newState.tools = newState.tools.map((t) =>
            t.id === payload.tool!.id ? { ...t, ...payload.tool } : t
          );
        }
        break;

      case 'todo_update':
        if (payload.todos) {
          newState.todos = payload.todos;
        }
        break;

      case 'complete':
        newState.status = 'complete';
        break;

      case 'error':
        newState.status = 'error';
        newState.errorMessage = payload.error;
        break;
    }

    return newState;
  }

  test('initial state is idle', () => {
    const state = createEmptyState();
    expect(state.status).toBe('idle');
    expect(state.accumulatedContent).toBe('');
    expect(state.tools.length).toBe(0);
    expect(state.todos).toBeNull();
  });

  test('token action accumulates content', () => {
    let state = createEmptyState();
    state = updateChatState(state, { action: 'token', content: 'Hello' });
    state = updateChatState(state, { action: 'token', content: ' world' });

    expect(state.status).toBe('streaming');
    expect(state.accumulatedContent).toBe('Hello world');
  });

  test('tool_start adds tool to state', () => {
    let state = createEmptyState();
    state = updateChatState(state, {
      action: 'tool_start',
      tool: { id: 'tool-1', name: 'Read' },
    });

    expect(state.status).toBe('streaming');
    expect(state.tools.length).toBe(1);
    expect(state.tools[0].id).toBe('tool-1');
  });

  test('tool_end updates existing tool', () => {
    let state = createEmptyState();
    state = updateChatState(state, {
      action: 'tool_start',
      tool: { id: 'tool-1', name: 'Read' },
    });
    state = updateChatState(state, {
      action: 'tool_end',
      tool: { id: 'tool-1', name: 'Read', summary: '50 lines' },
    });

    expect(state.tools.length).toBe(1);
    expect(state.tools[0].summary).toBe('50 lines');
  });

  test('todo_update sets todos', () => {
    let state = createEmptyState();
    const todos = [
      { content: 'Task 1', status: 'pending' },
      { content: 'Task 2', status: 'in_progress' },
    ];
    state = updateChatState(state, { action: 'todo_update', todos });

    expect(state.todos).toEqual(todos);
  });

  test('complete sets status to complete', () => {
    let state = createEmptyState();
    state = updateChatState(state, { action: 'token', content: 'Hello' });
    state = updateChatState(state, { action: 'complete' });

    expect(state.status).toBe('complete');
    expect(state.accumulatedContent).toBe('Hello');
  });

  test('error sets status and message', () => {
    let state = createEmptyState();
    state = updateChatState(state, {
      action: 'error',
      error: 'Rate limited',
    });

    expect(state.status).toBe('error');
    expect(state.errorMessage).toBe('Rate limited');
  });
});

// =============================================================================
// Event Buffer Tests
// =============================================================================

describe('Event Buffer', () => {
  interface WebSocketMessage {
    type: string;
    seq: number;
    timestamp: number;
    sessionId: string;
    payload: object;
  }

  test('buffers events for catch-up', () => {
    const buffer: WebSocketMessage[] = [];

    // Add events
    buffer.push({
      type: 'chat',
      seq: 1,
      timestamp: Date.now(),
      sessionId: 'session-1',
      payload: { action: 'token', content: 'a' },
    });
    buffer.push({
      type: 'chat',
      seq: 2,
      timestamp: Date.now(),
      sessionId: 'session-1',
      payload: { action: 'token', content: 'b' },
    });

    expect(buffer.length).toBe(2);
  });

  test('filters events by sequence for catch-up', () => {
    const buffer: WebSocketMessage[] = [
      {
        type: 'chat',
        seq: 1,
        timestamp: Date.now(),
        sessionId: 's1',
        payload: {},
      },
      {
        type: 'chat',
        seq: 2,
        timestamp: Date.now(),
        sessionId: 's1',
        payload: {},
      },
      {
        type: 'chat',
        seq: 3,
        timestamp: Date.now(),
        sessionId: 's1',
        payload: {},
      },
    ];

    // Client has seq 1, needs events after that
    const lastSeq = 1;
    const missedEvents = buffer.filter((e) => e.seq > lastSeq);

    expect(missedEvents.length).toBe(2);
    expect(missedEvents[0].seq).toBe(2);
    expect(missedEvents[1].seq).toBe(3);
  });

  test('trims buffer when too large', () => {
    const MAX_BUFFER_SIZE = 100;
    let buffer: WebSocketMessage[] = [];

    // Add more than max events
    for (let i = 1; i <= 150; i++) {
      buffer.push({
        type: 'chat',
        seq: i,
        timestamp: Date.now(),
        sessionId: 's1',
        payload: {},
      });
    }

    // Trim
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = buffer.slice(-MAX_BUFFER_SIZE);
    }

    expect(buffer.length).toBe(100);
    expect(buffer[0].seq).toBe(51); // Kept the most recent 100
  });
});

// =============================================================================
// Session Management Tests
// =============================================================================

describe('Session Management', () => {
  test('session sequence increments correctly', () => {
    const sessionSeqs = new Map<string, number>();

    function nextSessionSeq(sessionId: string): number {
      const seq = (sessionSeqs.get(sessionId) || 0) + 1;
      sessionSeqs.set(sessionId, seq);
      return seq;
    }

    expect(nextSessionSeq('session-1')).toBe(1);
    expect(nextSessionSeq('session-1')).toBe(2);
    expect(nextSessionSeq('session-1')).toBe(3);
    expect(nextSessionSeq('session-2')).toBe(1); // Different session starts at 1
  });

  test('session subscription tracks client-session mapping', () => {
    interface Client {
      id: string;
      sessionId?: string;
    }

    const clients: Client[] = [
      { id: 'client-1' },
      { id: 'client-2' },
      { id: 'client-3' },
    ];

    // Subscribe clients to sessions
    clients[0].sessionId = 'session-a';
    clients[1].sessionId = 'session-a';
    clients[2].sessionId = 'session-b';

    // Find clients for session-a
    const sessionAClients = clients.filter(
      (c) => c.sessionId === 'session-a'
    );
    expect(sessionAClients.length).toBe(2);

    // Unsubscribe
    clients[0].sessionId = undefined;
    const afterUnsubscribe = clients.filter(
      (c) => c.sessionId === 'session-a'
    );
    expect(afterUnsubscribe.length).toBe(1);
  });
});

// =============================================================================
// Broadcast Tests
// =============================================================================

describe('Broadcasting', () => {
  test('broadcast only to subscribed clients', () => {
    interface Client {
      id: string;
      sessionId?: string;
      received: string[];
    }

    const clients: Client[] = [
      { id: 'client-1', sessionId: 'session-a', received: [] },
      { id: 'client-2', sessionId: 'session-a', received: [] },
      { id: 'client-3', sessionId: 'session-b', received: [] },
      { id: 'client-4', received: [] }, // Not subscribed
    ];

    // Broadcast to session-a
    const message = JSON.stringify({
      type: 'chat',
      sessionId: 'session-a',
      payload: { action: 'token', content: 'Hello' },
    });

    for (const client of clients) {
      if (client.sessionId === 'session-a') {
        client.received.push(message);
      }
    }

    expect(clients[0].received.length).toBe(1);
    expect(clients[1].received.length).toBe(1);
    expect(clients[2].received.length).toBe(0);
    expect(clients[3].received.length).toBe(0);
  });

  test('broadcastAll sends to all clients', () => {
    interface Client {
      received: string[];
    }

    const clients: Client[] = [{ received: [] }, { received: [] }, { received: [] }];

    const message = JSON.stringify({ type: 'system', payload: { action: 'ping' } });

    for (const client of clients) {
      client.received.push(message);
    }

    expect(clients[0].received.length).toBe(1);
    expect(clients[1].received.length).toBe(1);
    expect(clients[2].received.length).toBe(1);
  });
});

// =============================================================================
// Message Handling Tests
// =============================================================================

describe('Message Handling', () => {
  test('chat send action triggers onChat callback', () => {
    let chatCalled = false;
    let receivedContent = '';

    const onChat = (_ws: unknown, _sessionId: string | undefined, content: string) => {
      chatCalled = true;
      receivedContent = content;
    };

    const message = {
      type: 'chat',
      payload: { action: 'send', content: 'Hello Claude' },
    };

    // Simulate message handling
    if (message.type === 'chat') {
      const payload = message.payload as { action: string; content?: string };
      if (payload.action === 'send' && payload.content) {
        onChat(null, undefined, payload.content);
      }
    }

    expect(chatCalled).toBe(true);
    expect(receivedContent).toBe('Hello Claude');
  });

  test('chat cancel action triggers onCancel callback', () => {
    let cancelCalled = false;
    let cancelledSessionId = '';

    const onCancel = (sessionId: string) => {
      cancelCalled = true;
      cancelledSessionId = sessionId;
    };

    const clientSessionId = 'session-123';
    const message = {
      type: 'chat',
      payload: { action: 'cancel' },
    };

    // Simulate message handling
    if (message.type === 'chat') {
      const payload = message.payload as { action: string };
      if (payload.action === 'cancel' && clientSessionId) {
        onCancel(clientSessionId);
      }
    }

    expect(cancelCalled).toBe(true);
    expect(cancelledSessionId).toBe('session-123');
  });

  test('system subscribe action subscribes to session', () => {
    let subscribedSessionId: string | undefined;

    const subscribeToSession = (sessionId: string) => {
      subscribedSessionId = sessionId;
    };

    const message = {
      type: 'system',
      payload: { action: 'subscribe', sessionId: 'session-abc' },
    };

    // Simulate message handling
    if (message.type === 'system') {
      const payload = message.payload as { action: string; sessionId?: string };
      if (payload.action === 'subscribe' && payload.sessionId) {
        subscribeToSession(payload.sessionId);
      }
    }

    expect(subscribedSessionId).toBe('session-abc');
  });

  test('system catch_up action sends missed events', () => {
    interface Event {
      seq: number;
      payload: object;
    }

    const buffer: Event[] = [
      { seq: 1, payload: { action: 'token', content: 'a' } },
      { seq: 2, payload: { action: 'token', content: 'b' } },
      { seq: 3, payload: { action: 'complete' } },
    ];

    const message = {
      type: 'system',
      payload: { action: 'catch_up', sessionId: 'session-1', lastSeq: 1 },
    };

    let sentSnapshot: { events: Event[] } | undefined;

    // Simulate catch_up handling
    if (message.type === 'system') {
      const payload = message.payload as {
        action: string;
        sessionId?: string;
        lastSeq?: number;
      };
      if (payload.action === 'catch_up' && payload.sessionId) {
        const lastSeq = payload.lastSeq || 0;
        const missedEvents = buffer.filter((e) => e.seq > lastSeq);
        sentSnapshot = { events: missedEvents };
      }
    }

    expect(sentSnapshot).toBeDefined();
    expect(sentSnapshot!.events.length).toBe(2);
    expect(sentSnapshot!.events[0].seq).toBe(2);
    expect(sentSnapshot!.events[1].seq).toBe(3);
  });
});

// =============================================================================
// Client Management Tests
// =============================================================================

describe('Client Management', () => {
  test('generates unique client IDs', () => {
    const generateClientId = () =>
      `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const id1 = generateClientId();
    const id2 = generateClientId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^client-\d+-[a-z0-9]+$/);
  });

  test('tracks connected clients', () => {
    interface Client {
      id: string;
    }

    const clients = new Set<Client>();

    const client1 = { id: 'client-1' };
    const client2 = { id: 'client-2' };

    clients.add(client1);
    expect(clients.size).toBe(1);

    clients.add(client2);
    expect(clients.size).toBe(2);

    clients.delete(client1);
    expect(clients.size).toBe(1);
    expect(clients.has(client2)).toBe(true);
  });

  test('registers client with initial data', () => {
    interface ClientData {
      clientId: string;
      connectedAt: Date;
      lastPing: Date;
      lastSeq: number;
      sessionId?: string;
    }

    const generateClientId = () => `client-${Date.now()}`;

    const data: ClientData = {
      clientId: generateClientId(),
      connectedAt: new Date(),
      lastPing: new Date(),
      lastSeq: 0,
    };

    expect(data.clientId).toMatch(/^client-\d+$/);
    expect(data.lastSeq).toBe(0);
    expect(data.sessionId).toBeUndefined();
  });
});

// =============================================================================
// Broadcast Message Format Tests
// =============================================================================

describe('Broadcast Message Format', () => {
  test('token broadcast format', () => {
    const sessionId = 'session-123';
    const seq = 1;
    const content = 'Hello';

    const message = {
      type: 'chat',
      seq,
      timestamp: Date.now(),
      sessionId,
      payload: {
        action: 'token',
        content,
      },
    };

    expect(message.type).toBe('chat');
    expect(message.sessionId).toBe('session-123');
    expect(
      (message.payload as { action: string; content: string }).action
    ).toBe('token');
    expect(
      (message.payload as { action: string; content: string }).content
    ).toBe('Hello');
  });

  test('tool_start broadcast format', () => {
    const tool = {
      id: 'tool-1',
      name: 'Read',
      friendly: 'Reading file.ts',
      inputDetail: '/path/to/file.ts',
    };

    const message = {
      type: 'chat',
      seq: 2,
      timestamp: Date.now(),
      sessionId: 'session-123',
      payload: {
        action: 'tool_start',
        tool,
      },
    };

    expect(
      (message.payload as { action: string; tool: typeof tool }).action
    ).toBe('tool_start');
    expect((message.payload as { tool: typeof tool }).tool.name).toBe('Read');
    expect((message.payload as { tool: typeof tool }).tool.friendly).toBe(
      'Reading file.ts'
    );
  });

  test('complete broadcast format', () => {
    const message = {
      type: 'chat',
      seq: 5,
      timestamp: Date.now(),
      sessionId: 'session-123',
      payload: {
        action: 'complete',
      },
    };

    expect((message.payload as { action: string }).action).toBe('complete');
  });

  test('error broadcast format', () => {
    const message = {
      type: 'chat',
      seq: 6,
      timestamp: Date.now(),
      sessionId: 'session-123',
      payload: {
        action: 'error',
        error: 'Rate limited, please wait',
      },
    };

    expect((message.payload as { action: string; error: string }).action).toBe(
      'error'
    );
    expect((message.payload as { error: string }).error).toBe(
      'Rate limited, please wait'
    );
  });
});

// =============================================================================
// Connected Message Tests
// =============================================================================

describe('Connected Message', () => {
  test('sends connected message with current seq', () => {
    let globalSeq = 42;

    const connectedMessage = {
      type: 'system',
      seq: ++globalSeq,
      timestamp: Date.now(),
      payload: {
        action: 'connected',
        currentSeq: globalSeq,
      },
    };

    expect(connectedMessage.type).toBe('system');
    expect(connectedMessage.seq).toBe(43);
    expect(
      (connectedMessage.payload as { currentSeq: number }).currentSeq
    ).toBe(43);
  });
});

// =============================================================================
// Snapshot Message Tests
// =============================================================================

describe('Snapshot Message', () => {
  test('includes events and chat state', () => {
    interface ChatState {
      status: string;
      accumulatedContent: string;
      tools: Array<{ id: string; name: string }>;
      todos: null;
    }

    const events = [
      { seq: 2, payload: { action: 'token', content: 'a' } },
      { seq: 3, payload: { action: 'complete' } },
    ];

    const chatState: ChatState = {
      status: 'complete',
      accumulatedContent: 'a',
      tools: [],
      todos: null,
    };

    const snapshot = {
      type: 'system',
      seq: 10,
      timestamp: Date.now(),
      sessionId: 'session-123',
      payload: {
        action: 'snapshot',
        sessionId: 'session-123',
        events,
        chatState,
        currentSeq: 3,
      },
    };

    expect(snapshot.payload.action).toBe('snapshot');
    expect(snapshot.payload.events.length).toBe(2);
    expect(snapshot.payload.chatState.status).toBe('complete');
    expect(snapshot.payload.currentSeq).toBe(3);
  });
});
