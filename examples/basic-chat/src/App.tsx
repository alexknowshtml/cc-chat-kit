import { useState, useRef, useEffect } from 'react';
import { useClaude } from 'cc-chat-react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import type { ChatMessage, ToolUseData, TodoItem, ContentBlock } from 'cc-chat-react';

const WS_URL = 'ws://100.85.122.99:3457/ws';

// Theme hook with system preference detection
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return { theme, toggle };
}

// Format duration in milliseconds to human-readable string
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 100) / 10}s`;
}

// SVG Icons
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

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function App() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

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
    <div className="container">
      {/* Header */}
      <header className="header">
        <h1 className="title">Claude Code Chat UI</h1>
        <div className="header-right">
          <button onClick={toggleTheme} className="theme-toggle" aria-label="Toggle theme">
            {theme === 'light' ? <MoonIcon className="theme-icon" /> : <SunIcon className="theme-icon" />}
          </button>
          <div className="status">
            <span
              className="status-dot"
              style={{
                backgroundColor:
                  status === 'connected'
                    ? 'var(--color-success)'
                    : status === 'connecting' || status === 'reconnecting'
                    ? 'var(--color-warning)'
                    : 'var(--color-error)',
              }}
            />
            {status}
          </div>
        </div>
      </header>

      {/* Sidebar - Todos */}
      {todos && todos.length > 0 && (
        <aside className="sidebar">
          <h3 className="sidebar-title">Tasks</h3>
          {todos.map((todo, i) => (
            <TodoItemView key={i} todo={todo} />
          ))}
        </aside>
      )}

      {/* Messages */}
      <main className="main">
        <div className="messages">
          {messages.map((msg) => (
            <MessageView key={msg.id} message={msg} isStreaming={msg.isStreaming} />
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && <div className="error">{error}</div>}

        {/* Input */}
        <form onSubmit={handleSubmit} className="input-form">
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
            className="input"
          />
          {isStreaming ? (
            <button type="button" onClick={cancel} className="cancel-button">
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={status !== 'connected' || !input.trim()}
              className="send-button"
            >
              Send
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

function MessageView({ message, isStreaming }: { message: ChatMessage; isStreaming?: boolean }) {
  const isUser = message.role === 'user';

  // User messages - simple render
  if (isUser) {
    return (
      <div className="message user-message">
        <div className="message-role">You</div>
        <div className="message-content">{message.content}</div>
      </div>
    );
  }

  // Assistant messages - render interleaved content blocks if available
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

  if (hasContentBlocks) {
    return (
      <div className="assistant-wrapper">
        <div className="message-role">Claude Code</div>
        {message.contentBlocks!.map((block, idx) => (
          <ContentBlockView
            key={idx}
            block={block}
            isLast={idx === message.contentBlocks!.length - 1}
            isStreaming={isStreaming}
          />
        ))}
        {isStreaming && <span className="cursor">▋</span>}
      </div>
    );
  }

  // Fallback: legacy rendering for messages without contentBlocks
  const activeTools = message.tools?.filter(t => t.duration === undefined) || [];
  const completedTools = message.tools?.filter(t => t.duration !== undefined) || [];
  const hasTools = (message.tools?.length || 0) > 0;

  return (
    <>
      {hasTools && (
        <div className="tool-group-wrapper">
          <div className="message-role">Claude Code</div>
          <ToolGroupView
            tools={completedTools}
            activeTools={activeTools}
          />
        </div>
      )}

      {(message.content || (isStreaming && !hasTools)) && (
        <div className="message assistant-message">
          {!hasTools && <div className="message-role">Claude Code</div>}
          <div className="message-content streamdown-content">
            {message.content ? (
              <>
                <Streamdown plugins={{ code }}>{message.content}</Streamdown>
                {isStreaming && <span className="cursor">▋</span>}
              </>
            ) : (
              <span className="thinking">Thinking<span className="thinking-dots"></span></span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ContentBlockView({
  block,
  isLast,
  isStreaming,
}: {
  block: ContentBlock;
  isLast: boolean;
  isStreaming?: boolean;
}) {
  if (block.type === 'text') {
    return (
      <div className="content-block-text streamdown-content">
        <Streamdown plugins={{ code }}>{block.content}</Streamdown>
      </div>
    );
  }

  if (block.type === 'tool_group') {
    const activeTools = block.tools.filter(t => t.duration === undefined);
    const completedTools = block.tools.filter(t => t.duration !== undefined);

    return (
      <div className="content-block-tools">
        <ToolGroupView tools={completedTools} activeTools={activeTools} />
      </div>
    );
  }

  return null;
}

function ToolGroupView({
  tools,
  activeTools,
}: {
  tools: ToolUseData[];
  activeTools: ToolUseData[];
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  const allTools = [...activeTools, ...tools];
  if (allTools.length === 0) return null;

  allTools.sort((a, b) => {
    const aStart = a.startTime || 0;
    const bStart = b.startTime || 0;
    return aStart - bStart;
  });

  const hasActive = activeTools.length > 0;
  const errorCount = allTools.filter(t => t.error).length;
  const totalCount = allTools.length;

  const headerText = hasActive
    ? `Using ${totalCount} tool${totalCount !== 1 ? 's' : ''}`
    : `Used ${totalCount} tool${totalCount !== 1 ? 's' : ''}`;

  return (
    <div className="tool-group">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="tool-group-header"
      >
        <ChevronIcon
          className="tool-chevron"
          direction={isExpanded ? 'down' : 'right'}
        />
        <span className="tool-group-title">
          {headerText}
          {errorCount > 0 && (
            <span className="error-count"> ({errorCount} failed)</span>
          )}
        </span>
        {hasActive ? (
          <LoaderIcon className="tool-spinner" />
        ) : (
          <CheckIcon className="tool-check" />
        )}
      </button>

      {isExpanded && (
        <div className="tool-group-content">
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
    <div className="tool-item">
      <div
        className="tool-item-header"
        onClick={() => hasSummary && setShowSummary(!showSummary)}
      >
        <div className="tool-item-icon">
          {isActive ? (
            <LoaderIcon className="tool-spinner-small" />
          ) : tool.error ? (
            <AlertIcon className="tool-error-icon" />
          ) : (
            <CheckIcon className="tool-success-icon" />
          )}
        </div>

        <div className="tool-item-content">
          <div className="tool-item-name-row">
            <span className={`tool-item-name ${isActive ? 'active' : ''}`}>
              {tool.friendly || tool.name}
            </span>
            {tool.duration && tool.duration > 0 && (
              <span className="tool-item-duration">
                {formatDuration(tool.duration)}
              </span>
            )}
          </div>
          {tool.inputDetail && (
            <div className="tool-input-detail">
              {tool.inputDetail}
            </div>
          )}
        </div>

        {hasSummary && hasMoreLines && (
          <ChevronIcon
            className="tool-summary-chevron"
            direction={showSummary ? 'down' : 'right'}
          />
        )}
      </div>

      {hasSummary && !showSummary && !isActive && (
        <div
          className="summary-preview"
          onClick={() => setShowSummary(true)}
        >
          {summaryLines.slice(0, previewLimit).map((line, i) => (
            <div key={i} className={`summary-line ${tool.error ? 'error' : 'success'}`}>
              {line || '\u00A0'}
            </div>
          ))}
          {hasMoreLines && (
            <div className="summary-more">
              +{lineCount - previewLimit} more lines
            </div>
          )}
        </div>
      )}

      {showSummary && tool.summary && (
        <div className="tool-summary">
          <pre className={`summary-text ${tool.error ? 'error' : 'success'}`}>
            {tool.summary}
          </pre>
        </div>
      )}
    </div>
  );
}

function TodoItemView({ todo }: { todo: TodoItem }) {
  return (
    <div className={`todo-item ${todo.status}`}>
      <div className="todo-icon">
        {todo.status === 'completed' ? (
          <CheckIcon className="todo-check" />
        ) : todo.status === 'in_progress' ? (
          <LoaderIcon className="todo-spinner" />
        ) : (
          <span className="todo-pending">○</span>
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
