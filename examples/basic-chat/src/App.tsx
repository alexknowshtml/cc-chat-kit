import { useState, useRef, useEffect } from 'react';
import { useClaude } from '@anthropic/claude-chat-react';
import type { ChatMessage, ToolUseData, TodoItem } from '@anthropic/claude-chat-react';

const WS_URL = 'ws://100.85.122.99:3456/ws';

// Format duration in milliseconds to human-readable string
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 100) / 10}s`;
}

// SVG Icons (inline to avoid dependencies)
function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function ChevronIcon({ className, direction = 'right' }: { className?: string; direction?: 'right' | 'down' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: direction === 'down' ? 'rotate(90deg)' : undefined }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

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
  }, [messages, streamingContent, activeTools]);

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
            />
          )}

          {/* Streaming text */}
          {isStreaming && streamingContent && (
            <div style={{ ...styles.message, ...styles.assistantMessage }}>
              <div style={styles.messageRole}>Claude</div>
              <div style={styles.messageContent}>
                {streamingContent}
                <span style={styles.cursor}>▋</span>
              </div>
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
        />
      )}
    </div>
  );
}

function ToolGroupView({
  tools,
  activeTools,
}: {
  tools: ToolUseData[];
  activeTools: ToolUseData[];
}) {
  // Default to expanded (like Andy's UI)
  const [isExpanded, setIsExpanded] = useState(true);

  const allTools = [...activeTools, ...tools];
  if (allTools.length === 0) return null;

  const hasActive = activeTools.length > 0;
  const errorCount = allTools.filter(t => t.error).length;
  const totalCount = allTools.length;

  const headerText = hasActive
    ? `Using ${totalCount} tool${totalCount !== 1 ? 's' : ''}`
    : `Used ${totalCount} tool${totalCount !== 1 ? 's' : ''}`;

  return (
    <div style={styles.toolGroup}>
      {/* Collapsed summary - clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={styles.toolGroupHeader}
      >
        <ChevronIcon
          className="tool-chevron"
          direction={isExpanded ? 'down' : 'right'}
        />
        <span style={styles.toolGroupTitle}>
          {headerText}
          {errorCount > 0 && (
            <span style={styles.errorCount}> ({errorCount} failed)</span>
          )}
        </span>
        {hasActive ? (
          <LoaderIcon className="tool-spinner" />
        ) : (
          <CheckIcon className="tool-check" />
        )}
      </button>

      {/* Expanded tool list */}
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
  const summaryLines = tool.summary?.split('\n') || [];
  const lineCount = summaryLines.length;
  const previewLimit = 3;
  const hasMoreLines = lineCount > previewLimit;

  return (
    <div style={styles.toolItem}>
      <div
        style={styles.toolItemHeader}
        onClick={() => hasSummary && setShowSummary(!showSummary)}
      >
        {/* Status icon */}
        <div style={styles.toolItemIcon}>
          {isActive ? (
            <LoaderIcon className="tool-spinner-small" />
          ) : tool.error ? (
            <AlertIcon className="tool-error-icon" />
          ) : (
            <CheckIcon className="tool-success-icon" />
          )}
        </div>

        {/* Tool name and details */}
        <div style={styles.toolItemContent}>
          <div style={styles.toolItemNameRow}>
            <span style={{
              ...styles.toolItemName,
              color: isActive ? '#eee' : '#888',
            }}>
              {tool.friendly || tool.name}
            </span>
            {tool.duration && tool.duration > 0 && (
              <span style={styles.toolItemDuration}>
                {formatDuration(tool.duration)}
              </span>
            )}
          </div>
          {/* Input detail (file path, command, etc.) */}
          {tool.inputDetail && (
            <div style={styles.toolInputDetail}>
              {tool.inputDetail}
            </div>
          )}
        </div>

        {hasSummary && (
          <ChevronIcon
            className="tool-summary-chevron"
            direction={showSummary ? 'down' : 'right'}
          />
        )}
      </div>

      {/* Summary preview */}
      {hasSummary && !showSummary && !isActive && (
        <div
          style={styles.summaryPreview}
          onClick={() => setShowSummary(true)}
        >
          {summaryLines.slice(0, previewLimit).map((line, i) => (
            <div key={i} style={{
              ...styles.summaryLine,
              color: tool.error ? 'rgba(239, 68, 68, 0.8)' : 'rgba(74, 222, 128, 0.8)',
            }}>
              {line || '\u00A0'}
            </div>
          ))}
          {hasMoreLines && (
            <div style={styles.summaryMore}>
              +{lineCount - previewLimit} more lines
            </div>
          )}
        </div>
      )}

      {/* Expanded summary */}
      {showSummary && tool.summary && (
        <div style={styles.toolSummary}>
          <pre style={{
            ...styles.summaryText,
            color: tool.error ? 'rgba(239, 68, 68, 0.8)' : 'rgba(74, 222, 128, 0.8)',
          }}>
            {tool.summary}
          </pre>
        </div>
      )}
    </div>
  );
}

function TodoItemView({ todo }: { todo: TodoItem }) {
  return (
    <div
      style={{
        ...styles.todoItem,
        ...(todo.status === 'completed' ? styles.todoCompleted : {}),
        ...(todo.status === 'in_progress' ? styles.todoActive : {}),
      }}
    >
      <div style={styles.todoIcon}>
        {todo.status === 'completed' ? (
          <CheckIcon className="todo-check" />
        ) : todo.status === 'in_progress' ? (
          <LoaderIcon className="todo-spinner" />
        ) : (
          <span style={styles.todoPending}>○</span>
        )}
      </div>
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
    marginBottom: '16px',
    padding: '16px',
    borderRadius: '16px',
  },
  userMessage: {
    background: 'rgba(99, 102, 241, 0.15)',
    marginLeft: '40px',
    borderTopRightRadius: '4px',
  },
  assistantMessage: {
    background: '#1e1e36',
    marginRight: '40px',
    borderTopLeftRadius: '4px',
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
  cursor: {
    opacity: 0.7,
    animation: 'pulse 1s ease-in-out infinite',
  },
  toolGroup: {
    marginTop: '12px',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  toolGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px 12px',
    background: 'transparent',
    border: 'none',
    color: '#888',
    fontSize: '12px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  toolGroupTitle: {
    flex: 1,
  },
  errorCount: {
    color: '#ef4444',
  },
  toolGroupContent: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    padding: '8px 12px',
  },
  toolItem: {
    padding: '6px 0',
  },
  toolItemHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    cursor: 'pointer',
  },
  toolItemIcon: {
    width: '16px',
    height: '16px',
    marginTop: '2px',
    flexShrink: 0,
  },
  toolItemContent: {
    flex: 1,
    minWidth: 0,
  },
  toolItemNameRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  toolItemName: {
    fontSize: '12px',
    fontWeight: 500,
  },
  toolItemDuration: {
    fontSize: '10px',
    color: 'rgba(136, 136, 136, 0.5)',
  },
  toolInputDetail: {
    fontSize: '11px',
    color: 'rgba(136, 136, 136, 0.7)',
    marginTop: '2px',
    whiteSpace: 'pre' as const,
    overflow: 'auto',
  },
  summaryPreview: {
    marginTop: '6px',
    marginLeft: '24px',
    padding: '6px 8px',
    background: 'rgba(0, 0, 0, 0.2)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '10px',
    fontFamily: 'monospace',
  },
  summaryLine: {
    whiteSpace: 'pre' as const,
    lineHeight: 1.4,
  },
  summaryMore: {
    marginTop: '4px',
    fontSize: '9px',
    color: 'rgba(136, 136, 136, 0.5)',
  },
  toolSummary: {
    marginTop: '8px',
    marginLeft: '24px',
  },
  summaryText: {
    margin: 0,
    padding: '10px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    fontSize: '11px',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '200px',
    overflow: 'auto',
    lineHeight: 1.5,
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
    height: '16px',
  },
  todoPending: {
    fontSize: '14px',
    lineHeight: 1,
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
