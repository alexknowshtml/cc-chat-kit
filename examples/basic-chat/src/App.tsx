import { useState, useRef, useEffect } from 'react';
import { useClaude } from '@anthropic/claude-chat-react';
import type { ChatMessage, ToolUseData, TodoItem } from '@anthropic/claude-chat-react';

const WS_URL = 'ws://100.85.122.99:3456/ws';

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

          {/* Active tools - separate bubble */}
          {isStreaming && activeTools.length > 0 && (
            <ToolGroupView
              tools={[]}
              activeTools={activeTools}
              isStreaming={true}
            />
          )}

          {/* Streaming text */}
          {isStreaming && streamingContent && (
            <div style={{ ...styles.message, ...styles.assistantMessage }}>
              <div style={styles.messageRole}>Claude</div>
              <div style={styles.messageContent}>{streamingContent}</div>
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
        <ToolGroupView
          tools={message.tools}
          activeTools={[]}
          isStreaming={false}
        />
      )}
    </div>
  );
}

function ToolGroupView({
  tools,
  activeTools,
  isStreaming
}: {
  tools: ToolUseData[];
  activeTools: ToolUseData[];
  isStreaming: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const allTools = [...tools, ...activeTools];
  if (allTools.length === 0) return null;

  const hasActive = activeTools.length > 0;
  const completedCount = tools.length;
  const activeCount = activeTools.length;

  const headerText = hasActive
    ? `Using ${activeCount + completedCount} tool${activeCount + completedCount !== 1 ? 's' : ''}...`
    : `Used ${completedCount} tool${completedCount !== 1 ? 's' : ''}`;

  return (
    <div style={styles.toolGroup}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={styles.toolGroupHeader}
      >
        <span style={styles.toolGroupIcon}>
          {hasActive ? (
            <span style={styles.spinner}>⟳</span>
          ) : (
            <span style={styles.checkIcon}>✓</span>
          )}
        </span>
        <span style={styles.toolGroupTitle}>{headerText}</span>
        <span style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div style={styles.toolGroupContent}>
          {allTools.map((tool) => (
            <ToolItemView
              key={tool.id}
              tool={tool}
              isActive={activeTools.some(t => t.id === tool.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolItemView({ tool, isActive }: { tool: ToolUseData; isActive: boolean }) {
  const [showSummary, setShowSummary] = useState(false);

  const hasSummary = tool.summary && tool.summary.length > 0;

  return (
    <div style={styles.toolItem}>
      <div
        style={styles.toolItemHeader}
        onClick={() => hasSummary && setShowSummary(!showSummary)}
      >
        <span style={styles.toolItemIcon}>
          {isActive ? (
            <span style={styles.spinnerSmall}>⟳</span>
          ) : tool.error ? (
            <span style={styles.errorIcon}>✗</span>
          ) : (
            <span style={styles.successIcon}>✓</span>
          )}
        </span>
        <span style={styles.toolItemName}>{tool.friendly || tool.name}</span>
        {tool.duration && (
          <span style={styles.toolItemDuration}>{tool.duration}ms</span>
        )}
        {hasSummary && (
          <span style={styles.summaryToggle}>{showSummary ? '▼' : '▶'}</span>
        )}
      </div>

      {showSummary && tool.summary && (
        <div style={styles.toolSummary}>
          <pre style={styles.summaryText}>{tool.summary}</pre>
        </div>
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
  toolGroup: {
    marginBottom: '20px',
    marginRight: '40px',
    padding: '12px 16px',
    background: '#1a1a2e',
    borderRadius: '12px',
    border: '1px solid #333',
  },
  toolGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px 12px',
    background: 'transparent',
    border: 'none',
    color: '#ccc',
    fontSize: '13px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  toolGroupIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
  },
  toolGroupTitle: {
    flex: 1,
    fontWeight: 500,
  },
  expandIcon: {
    fontSize: '10px',
    color: '#666',
  },
  toolGroupContent: {
    borderTop: '1px solid #333',
    padding: '8px 0',
  },
  toolItem: {
    padding: '0 12px',
  },
  toolItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
    cursor: 'pointer',
  },
  toolItemIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    fontSize: '12px',
  },
  toolItemName: {
    flex: 1,
    fontSize: '13px',
    color: '#aaa',
  },
  toolItemDuration: {
    fontSize: '11px',
    color: '#666',
  },
  summaryToggle: {
    fontSize: '10px',
    color: '#666',
  },
  toolSummary: {
    padding: '8px 0 8px 24px',
  },
  summaryText: {
    margin: 0,
    padding: '8px',
    background: '#0d0d1a',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#888',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '150px',
    overflow: 'auto',
  },
  spinner: {
    display: 'inline-block',
    animation: 'spin 1s linear infinite',
    color: '#facc15',
  },
  spinnerSmall: {
    display: 'inline-block',
    animation: 'spin 1s linear infinite',
    color: '#facc15',
    fontSize: '12px',
  },
  checkIcon: {
    color: '#4ade80',
  },
  successIcon: {
    color: '#4ade80',
  },
  errorIcon: {
    color: '#ef4444',
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
