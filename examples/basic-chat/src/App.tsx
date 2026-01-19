import { useState, useRef, useEffect } from 'react';
import { useClaude } from '@anthropic/claude-chat-react';
import type { ChatMessage, ToolUseData, TodoItem } from '@anthropic/claude-chat-react';

const WS_URL = 'ws://localhost:3000/ws';

export default function App() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    status,
    messages,
    streamingContent,
    activeTools,
    todos,
    isStreaming,
    error,
    send,
    cancel,
  } = useClaude({
    url: WS_URL,
    onConnect: () => console.log('Connected to Claude'),
    onDisconnect: () => console.log('Disconnected from Claude'),
    onError: (err) => console.error('Error:', err),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    send(input.trim());
    setInput('');
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>Claude Chat</h1>
        <div style={styles.status}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor:
                status === 'connected'
                  ? '#4ade80'
                  : status === 'connecting' || status === 'reconnecting'
                  ? '#facc15'
                  : '#ef4444',
            }}
          />
          {status}
        </div>
      </header>

      {/* Sidebar - Todos */}
      {todos && todos.length > 0 && (
        <aside style={styles.sidebar}>
          <h3 style={styles.sidebarTitle}>Tasks</h3>
          {todos.map((todo, i) => (
            <TodoItemView key={i} todo={todo} />
          ))}
        </aside>
      )}

      {/* Messages */}
      <main style={styles.main}>
        <div style={styles.messages}>
          {messages.map((msg) => (
            <MessageView key={msg.id} message={msg} />
          ))}

          {/* Active tools */}
          {activeTools.length > 0 && (
            <div style={styles.activeTools}>
              {activeTools.map((tool) => (
                <ToolView key={tool.id} tool={tool} active />
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && <div style={styles.error}>{error}</div>}

        {/* Input */}
        <form onSubmit={handleSubmit} style={styles.inputForm}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              status !== 'connected'
                ? 'Connecting...'
                : isStreaming
                ? 'Claude is responding...'
                : 'Type a message...'
            }
            disabled={status !== 'connected'}
            style={styles.input}
          />
          {isStreaming ? (
            <button type="button" onClick={cancel} style={styles.cancelButton}>
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={status !== 'connected' || !input.trim()}
              style={styles.sendButton}
            >
              Send
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        ...styles.message,
        ...(isUser ? styles.userMessage : styles.assistantMessage),
      }}
    >
      <div style={styles.messageRole}>{isUser ? 'You' : 'Claude'}</div>
      <div style={styles.messageContent}>
        {message.content || (message.isStreaming && '...')}
      </div>
      {message.tools && message.tools.length > 0 && (
        <div style={styles.messageTools}>
          {message.tools.map((tool) => (
            <ToolView key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolView({ tool, active }: { tool: ToolUseData; active?: boolean }) {
  return (
    <div
      style={{
        ...styles.tool,
        ...(active ? styles.activeTool : {}),
        ...(tool.error ? styles.errorTool : {}),
      }}
    >
      <span style={styles.toolIcon}>{active ? '⏳' : tool.error ? '❌' : '✓'}</span>
      <span style={styles.toolName}>{tool.friendly || tool.name}</span>
      {tool.duration && (
        <span style={styles.toolDuration}>{tool.duration}ms</span>
      )}
    </div>
  );
}

function TodoItemView({ todo }: { todo: TodoItem }) {
  const icon =
    todo.status === 'completed'
      ? '✓'
      : todo.status === 'in_progress'
      ? '→'
      : '○';

  return (
    <div
      style={{
        ...styles.todoItem,
        ...(todo.status === 'completed' ? styles.todoCompleted : {}),
        ...(todo.status === 'in_progress' ? styles.todoActive : {}),
      }}
    >
      <span style={styles.todoIcon}>{icon}</span>
      <span>
        {todo.status === 'in_progress' && todo.activeForm
          ? todo.activeForm
          : todo.content}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    maxWidth: '900px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid #333',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#888',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  sidebar: {
    padding: '16px 24px',
    borderBottom: '1px solid #333',
    background: '#16162a',
  },
  sidebarTitle: {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '12px',
    color: '#888',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
  },
  message: {
    marginBottom: '20px',
    padding: '16px',
    borderRadius: '12px',
  },
  userMessage: {
    background: '#2d2d4a',
    marginLeft: '40px',
  },
  assistantMessage: {
    background: '#1e1e36',
    marginRight: '40px',
  },
  messageRole: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#888',
    marginBottom: '8px',
  },
  messageContent: {
    fontSize: '15px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
  },
  messageTools: {
    marginTop: '12px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  activeTools: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '16px',
    background: '#16162a',
    borderRadius: '12px',
  },
  tool: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '6px',
    background: '#2d2d4a',
    fontSize: '13px',
  },
  activeTool: {
    background: '#3d3d6a',
    animation: 'pulse 2s infinite',
  },
  errorTool: {
    background: '#4a2d2d',
  },
  toolIcon: {
    fontSize: '12px',
  },
  toolName: {
    color: '#ccc',
  },
  toolDuration: {
    color: '#666',
    fontSize: '11px',
  },
  todoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 0',
    fontSize: '14px',
    color: '#888',
  },
  todoCompleted: {
    color: '#4ade80',
    textDecoration: 'line-through',
  },
  todoActive: {
    color: '#facc15',
  },
  todoIcon: {
    width: '16px',
  },
  error: {
    margin: '0 24px 16px',
    padding: '12px 16px',
    background: '#4a2d2d',
    borderRadius: '8px',
    color: '#f87171',
    fontSize: '14px',
  },
  inputForm: {
    display: 'flex',
    gap: '12px',
    padding: '16px 24px',
    borderTop: '1px solid #333',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #333',
    background: '#16162a',
    color: '#eee',
    fontSize: '15px',
    outline: 'none',
  },
  sendButton: {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  cancelButton: {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    background: '#ef4444',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
  },
};
