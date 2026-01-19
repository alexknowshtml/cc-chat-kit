/**
 * Claude CLI Spawner
 *
 * Spawns the Claude CLI process and parses the stream-json output.
 * This is the core logic extracted from the Andy chat server.
 */

import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type {
  ActiveProcess,
  ActiveTool,
  ChatPayload,
  ToolUseData,
  TodoItem,
  WS_CONFIG,
} from './types';

// =============================================================================
// Claude CLI Location
// =============================================================================

/**
 * Find the Claude CLI binary.
 * Checks common installation locations.
 */
export function findClaudePath(): string | null {
  const possiblePaths = [
    `${homedir()}/.local/bin/claude`,
    `${homedir()}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return null;
}

// =============================================================================
// Friendly Tool Names
// =============================================================================

/**
 * Convert tool name and input to a human-friendly description.
 */
export function getFriendlyToolName(
  toolName: string,
  input?: Record<string, unknown>
): string {
  switch (toolName) {
    case 'Read':
      if (input?.file_path) {
        const path = String(input.file_path);
        const filename = path.split('/').pop() || path;
        return `Reading ${filename}`;
      }
      return 'Reading file';

    case 'Write':
      if (input?.file_path) {
        const path = String(input.file_path);
        const filename = path.split('/').pop() || path;
        return `Writing ${filename}`;
      }
      return 'Writing file';

    case 'Edit':
      if (input?.file_path) {
        const path = String(input.file_path);
        const filename = path.split('/').pop() || path;
        return `Editing ${filename}`;
      }
      return 'Editing file';

    case 'Bash':
      if (input?.command) {
        const cmd = String(input.command);
        const firstWord = cmd.split(/\s+/)[0];
        return `Running ${firstWord}`;
      }
      return 'Running command';

    case 'Glob':
      if (input?.pattern) {
        return `Finding ${input.pattern}`;
      }
      return 'Finding files';

    case 'Grep':
      if (input?.pattern) {
        return `Searching for "${input.pattern}"`;
      }
      return 'Searching';

    case 'WebFetch':
      return 'Fetching URL';

    case 'WebSearch':
      if (input?.query) {
        return `Searching: ${String(input.query).substring(0, 30)}`;
      }
      return 'Web search';

    case 'Task':
      return 'Running agent';

    case 'TodoWrite':
      return 'Updating tasks';

    case 'AskUserQuestion':
      return 'Asking question';

    default:
      return toolName;
  }
}

/**
 * Get a short description of the tool input.
 */
export function getToolInputDetail(
  toolName: string,
  input?: Record<string, unknown>
): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return input.file_path ? String(input.file_path) : undefined;

    case 'Bash':
      return input.command
        ? String(input.command).substring(0, 100)
        : undefined;

    case 'Glob':
      return input.pattern ? String(input.pattern) : undefined;

    case 'Grep':
      return input.pattern ? String(input.pattern) : undefined;

    default:
      return undefined;
  }
}

/**
 * Summarize a tool result for display.
 */
export function summarizeToolResult(
  toolName: string,
  result: unknown
): string | undefined {
  if (!result) return undefined;

  const resultObj = result as Record<string, unknown>;

  // Check for error
  if (resultObj.isError) {
    const content = resultObj.content;
    if (Array.isArray(content) && content[0]?.text) {
      return `Error: ${String(content[0].text).substring(0, 50)}`;
    }
    return 'Error';
  }

  // Summarize by tool type
  switch (toolName) {
    case 'Read':
      if (Array.isArray(resultObj.content)) {
        const text = resultObj.content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('');
        const lines = text.split('\n').length;
        return `${lines} lines`;
      }
      return 'Read complete';

    case 'Glob':
      if (Array.isArray(resultObj.content)) {
        const text = resultObj.content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('');
        const files = text.split('\n').filter(Boolean).length;
        return `${files} files`;
      }
      return 'Search complete';

    case 'Bash':
      if (resultObj.stdout) {
        const lines = String(resultObj.stdout).split('\n').length;
        return `${lines} lines output`;
      }
      return 'Command complete';

    default:
      return 'Complete';
  }
}

// =============================================================================
// Stream Parser
// =============================================================================

export interface StreamCallbacks {
  onInit: (sessionId: string) => void;
  onText: (text: string) => void;
  onToolStart: (tool: ToolUseData) => void;
  onToolEnd: (tool: ToolUseData) => void;
  onTodoUpdate: (todos: TodoItem[]) => void;
  onThinking: (message: string) => void;
  onComplete: (result?: string) => void;
  onError: (error: string) => void;
}

/**
 * Parse Claude CLI stream-json output and invoke callbacks.
 */
export async function parseClaudeStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
  isAborted: () => boolean
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  const activeTools = new Map<string, ActiveTool>();
  let detectedSessionId: string | undefined;

  const MAX_BUFFER_SIZE = 20 * 1024 * 1024; // 20MB

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (isAborted()) {
        callbacks.onError('Request cancelled');
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // Prevent buffer overflow
      if (buffer.length > MAX_BUFFER_SIZE) {
        const lastNewline = buffer.lastIndexOf('\n');
        if (lastNewline > 0) {
          const incompletePart = buffer.slice(lastNewline + 1);
          if (incompletePart.length > MAX_BUFFER_SIZE / 2) {
            buffer = buffer.slice(0, lastNewline + 1);
          }
        }
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);
          processEvent(event, callbacks, activeTools, detectedSessionId, (id) => {
            detectedSessionId = id;
          });
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        processEvent(event, callbacks, activeTools, detectedSessionId, (id) => {
          detectedSessionId = id;
        });
      } catch {
        // Skip malformed JSON
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error.message : 'Stream error');
  }
}

/**
 * Process a single event from Claude's stream-json output.
 */
function processEvent(
  event: Record<string, unknown>,
  callbacks: StreamCallbacks,
  activeTools: Map<string, ActiveTool>,
  _detectedSessionId: string | undefined,
  setSessionId: (id: string) => void
): void {
  // Extract session ID from init event
  if (event.type === 'system' && event.subtype === 'init') {
    const sessionId = event.session_id as string;
    setSessionId(sessionId);
    callbacks.onInit(sessionId);
    return;
  }

  // Handle streaming text deltas (wrapped in stream_event)
  if (event.type === 'stream_event' && event.event) {
    const streamEvent = event.event as Record<string, unknown>;

    if (
      streamEvent.type === 'content_block_delta' &&
      (streamEvent.delta as Record<string, unknown>)?.type === 'text_delta'
    ) {
      const text = (streamEvent.delta as Record<string, string>).text;
      callbacks.onText(text);
    }

    // Early tool detection from content_block_start
    if (
      streamEvent.type === 'content_block_start' &&
      (streamEvent.content_block as Record<string, unknown>)?.type === 'tool_use'
    ) {
      const block = streamEvent.content_block as Record<string, unknown>;
      const toolId = block.id as string;
      const toolName = block.name as string;

      console.log('[Claude] content_block_start tool:', toolId, toolName, 'exists:', activeTools.has(toolId));

      if (!activeTools.has(toolId)) {
        const friendly = getFriendlyToolName(toolName);
        const startTime = Date.now();
        activeTools.set(toolId, {
          id: toolId,
          name: toolName,
          friendly,
          startTime,
        });
        callbacks.onToolStart({
          id: toolId,
          name: toolName,
          friendly,
          startTime,
        });
      }
    }
  }

  // Handle legacy content_block_delta (without stream_event wrapper)
  if (
    event.type === 'content_block_delta' &&
    (event.delta as Record<string, unknown>)?.type === 'text_delta'
  ) {
    const text = (event.delta as Record<string, string>).text;
    callbacks.onText(text);
  }

  // Tool usage from assistant message (has full input)
  if (event.type === 'assistant' && event.message) {
    const message = event.message as Record<string, unknown>;
    const content = message.content as Array<Record<string, unknown>> | undefined;

    if (content) {
      for (const block of content) {
        if (block.type === 'tool_use') {
          const toolId = block.id as string;
          const toolName = block.name as string;
          const toolInput = block.input as Record<string, unknown> | undefined;

          const friendly = getFriendlyToolName(toolName, toolInput);
          const inputDetail = getToolInputDetail(toolName, toolInput);

          const existingTool = activeTools.get(toolId);
          console.log('[Claude] assistant message tool:', toolId, toolName, 'exists:', !!existingTool);
          if (!existingTool) {
            // New tool - add to tracking and notify
            const startTime = Date.now();
            activeTools.set(toolId, {
              id: toolId,
              name: toolName,
              friendly,
              startTime,
            });
            callbacks.onToolStart({
              id: toolId,
              name: toolName,
              friendly,
              input: toolInput,
              inputDetail,
              startTime,
            });
          }
          // If tool already exists (from early detection), don't broadcast again

          // Handle TodoWrite specially
          if (toolName === 'TodoWrite' && toolInput?.todos) {
            const todos = toolInput.todos as TodoItem[];
            callbacks.onTodoUpdate(todos);
          }
        }
      }
    }
  }

  // Tool result from user message
  if (event.type === 'user' && event.tool_use_result) {
    const result = event.tool_use_result as Record<string, unknown>;
    const message = event.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;

    // Process ALL tool results in the content array, not just the first one
    if (content) {
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolId = block.tool_use_id as string;
          const activeTool = activeTools.get(toolId);
          const toolName = activeTool?.name || 'unknown';
          const duration = activeTool ? Date.now() - activeTool.startTime : 0;

          const summary = summarizeToolResult(toolName, result);

          console.log('[Claude] tool_end:', toolId, toolName, duration + 'ms');

          callbacks.onToolEnd({
            id: toolId,
            name: toolName,
            summary,
            duration,
            error: result.isError ? String(result.content) : undefined,
          });

          activeTools.delete(toolId);
        }
      }
    } else {
      // Fallback: try old approach if content array not available
      const toolId = (event.message as Record<string, unknown>)?.content?.[0]?.tool_use_id as string | undefined;
      if (toolId) {
        const activeTool = activeTools.get(toolId);
        const toolName = activeTool?.name || 'unknown';
        const duration = activeTool ? Date.now() - activeTool.startTime : 0;

        const summary = summarizeToolResult(toolName, result);

        console.log('[Claude] tool_end (fallback):', toolId, toolName, duration + 'ms');

        callbacks.onToolEnd({
          id: toolId,
          name: toolName,
          summary,
          duration,
          error: result.isError ? String(result.content) : undefined,
        });

        activeTools.delete(toolId);
      }
    }
  }

  // Result event (completion)
  if (event.type === 'result') {
    const result = event.result as string | undefined;
    callbacks.onComplete(result);
  }
}

// =============================================================================
// Claude Process Spawner
// =============================================================================

export interface SpawnClaudeOptions {
  prompt: string;
  projectPath: string;
  claudePath: string;
  sessionId?: string;
  appendSystemPrompt?: string;
}

/**
 * Spawn the Claude CLI process with streaming output.
 */
export function spawnClaude(options: SpawnClaudeOptions): {
  proc: ReturnType<typeof Bun.spawn>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
} {
  const args: string[] = [
    '--print',
    '--verbose',
    '--dangerously-skip-permissions',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
  ];

  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }

  if (options.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  args.push(options.prompt);

  const proc = Bun.spawn([options.claudePath, ...args], {
    cwd: options.projectPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const reader = proc.stdout.getReader();

  return { proc, reader };
}

/**
 * Parse stderr for user-friendly error messages.
 */
export async function parseStderr(
  stderr: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let output = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
  } catch {
    // Ignore read errors
  }

  // Extract meaningful error message
  const errorPatterns = [
    { match: /usage limit|limit reached/i, message: 'API usage limit reached' },
    { match: /rate limit|429/i, message: 'Rate limited, please wait' },
    { match: /session not found/i, message: 'Session expired' },
    { match: /context.*limit|exceed.*token/i, message: 'Context limit exceeded' },
    { match: /authentication|unauthorized|401/i, message: 'Authentication failed' },
    { match: /network|connection|ECONNREFUSED/i, message: 'Network error' },
  ];

  for (const pattern of errorPatterns) {
    if (pattern.match.test(output)) {
      return pattern.message;
    }
  }

  // Return first line of stderr if no pattern matched
  const firstLine = output.split('\n')[0]?.trim();
  return firstLine || 'Unknown error';
}
