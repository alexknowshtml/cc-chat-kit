/**
 * Tests for Claude CLI stream parser and utility functions.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
  getFriendlyToolName,
  getToolInputDetail,
  summarizeToolResult,
  parseClaudeStream,
  type StreamCallbacks,
} from './claude';

// =============================================================================
// getFriendlyToolName Tests
// =============================================================================

describe('getFriendlyToolName', () => {
  test('Read with file_path', () => {
    expect(getFriendlyToolName('Read', { file_path: '/path/to/file.ts' })).toBe(
      'Reading file.ts'
    );
  });

  test('Read without file_path', () => {
    expect(getFriendlyToolName('Read')).toBe('Reading file');
  });

  test('Write with file_path', () => {
    expect(
      getFriendlyToolName('Write', { file_path: '/path/to/output.json' })
    ).toBe('Writing output.json');
  });

  test('Edit with file_path', () => {
    expect(
      getFriendlyToolName('Edit', { file_path: '/src/components/App.tsx' })
    ).toBe('Editing App.tsx');
  });

  test('Bash with command', () => {
    expect(getFriendlyToolName('Bash', { command: 'npm install' })).toBe(
      'Running npm'
    );
  });

  test('Bash without command', () => {
    expect(getFriendlyToolName('Bash')).toBe('Running command');
  });

  test('Glob with pattern', () => {
    expect(getFriendlyToolName('Glob', { pattern: '**/*.ts' })).toBe(
      'Finding **/*.ts'
    );
  });

  test('Grep with pattern', () => {
    expect(getFriendlyToolName('Grep', { pattern: 'TODO' })).toBe(
      'Searching for "TODO"'
    );
  });

  test('WebFetch', () => {
    expect(getFriendlyToolName('WebFetch')).toBe('Fetching URL');
  });

  test('WebSearch with query', () => {
    expect(
      getFriendlyToolName('WebSearch', { query: 'how to parse JSON' })
    ).toBe('Searching: how to parse JSON');
  });

  test('WebSearch truncates long query', () => {
    const longQuery =
      'this is a very long search query that should be truncated at 30 characters';
    expect(getFriendlyToolName('WebSearch', { query: longQuery })).toBe(
      'Searching: this is a very long search que'
    );
  });

  test('Task', () => {
    expect(getFriendlyToolName('Task')).toBe('Running agent');
  });

  test('TodoWrite', () => {
    expect(getFriendlyToolName('TodoWrite')).toBe('Updating tasks');
  });

  test('AskUserQuestion', () => {
    expect(getFriendlyToolName('AskUserQuestion')).toBe('Asking question');
  });

  test('Unknown tool returns tool name', () => {
    expect(getFriendlyToolName('CustomTool')).toBe('CustomTool');
  });
});

// =============================================================================
// getToolInputDetail Tests
// =============================================================================

describe('getToolInputDetail', () => {
  test('Read returns file_path', () => {
    expect(getToolInputDetail('Read', { file_path: '/path/to/file.ts' })).toBe(
      '/path/to/file.ts'
    );
  });

  test('Write returns file_path', () => {
    expect(getToolInputDetail('Write', { file_path: '/output.json' })).toBe(
      '/output.json'
    );
  });

  test('Edit returns file_path', () => {
    expect(getToolInputDetail('Edit', { file_path: '/src/app.ts' })).toBe(
      '/src/app.ts'
    );
  });

  test('Bash returns command truncated', () => {
    const longCommand = 'a'.repeat(150);
    const result = getToolInputDetail('Bash', { command: longCommand });
    expect(result).toBe(longCommand.substring(0, 100));
  });

  test('Glob returns pattern', () => {
    expect(getToolInputDetail('Glob', { pattern: '**/*.tsx' })).toBe(
      '**/*.tsx'
    );
  });

  test('Grep returns pattern', () => {
    expect(getToolInputDetail('Grep', { pattern: 'error' })).toBe('error');
  });

  test('Returns undefined for unknown tool', () => {
    expect(getToolInputDetail('CustomTool', { foo: 'bar' })).toBeUndefined();
  });

  test('Returns undefined when no input', () => {
    expect(getToolInputDetail('Read')).toBeUndefined();
  });
});

// =============================================================================
// summarizeToolResult Tests
// =============================================================================

describe('summarizeToolResult', () => {
  test('Returns undefined for null result', () => {
    expect(summarizeToolResult('Read', null)).toBeUndefined();
  });

  test('Handles error result', () => {
    const result = {
      isError: true,
      content: [{ text: 'File not found' }],
    };
    expect(summarizeToolResult('Read', result)).toBe('Error: File not found');
  });

  test('Handles error result with truncation', () => {
    const result = {
      isError: true,
      content: [{ text: 'a'.repeat(100) }],
    };
    expect(summarizeToolResult('Read', result)).toBe(
      `Error: ${'a'.repeat(50)}`
    );
  });

  test('Handles error without text content', () => {
    const result = { isError: true };
    expect(summarizeToolResult('Read', result)).toBe('Error');
  });

  test('Read counts lines', () => {
    const result = {
      content: [{ type: 'text', text: 'line1\nline2\nline3' }],
    };
    expect(summarizeToolResult('Read', result)).toBe('3 lines');
  });

  test('Glob counts files', () => {
    const result = {
      content: [{ type: 'text', text: 'file1.ts\nfile2.ts\nfile3.ts' }],
    };
    expect(summarizeToolResult('Glob', result)).toBe('3 files');
  });

  test('Bash counts output lines', () => {
    const result = {
      stdout: 'output1\noutput2',
    };
    expect(summarizeToolResult('Bash', result)).toBe('2 lines output');
  });

  test('Unknown tool returns Complete', () => {
    expect(summarizeToolResult('CustomTool', {})).toBe('Complete');
  });
});

// =============================================================================
// parseClaudeStream Tests
// =============================================================================

describe('parseClaudeStream', () => {
  function createMockCallbacks(): StreamCallbacks & {
    calls: Record<string, unknown[][]>;
  } {
    const calls: Record<string, unknown[][]> = {
      onInit: [],
      onText: [],
      onToolStart: [],
      onToolEnd: [],
      onTodoUpdate: [],
      onThinking: [],
      onComplete: [],
      onError: [],
    };

    return {
      calls,
      onInit: (sessionId: string) => calls.onInit.push([sessionId]),
      onText: (text: string) => calls.onText.push([text]),
      onToolStart: (tool) => calls.onToolStart.push([tool]),
      onToolEnd: (tool) => calls.onToolEnd.push([tool]),
      onTodoUpdate: (todos) => calls.onTodoUpdate.push([todos]),
      onThinking: (message: string) => calls.onThinking.push([message]),
      onComplete: (result) => calls.onComplete.push([result]),
      onError: (error: string) => calls.onError.push([error]),
    };
  }

  function createMockReader(
    events: Record<string, unknown>[]
  ): ReadableStreamDefaultReader<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;

    return {
      read: async () => {
        if (index >= events.length) {
          return { done: true, value: undefined };
        }
        const line = JSON.stringify(events[index]) + '\n';
        index++;
        return { done: false, value: encoder.encode(line) };
      },
      releaseLock: () => {},
      cancel: async () => {},
      closed: Promise.resolve(undefined),
    } as ReadableStreamDefaultReader<Uint8Array>;
  }

  test('parses init event', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([
      { type: 'system', subtype: 'init', session_id: 'session-123' },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onInit).toEqual([['session-123']]);
  });

  test('parses text delta from stream_event', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' world' },
        },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onText).toEqual([['Hello'], [' world']]);
  });

  test('parses legacy content_block_delta', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Legacy text' },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onText).toEqual([['Legacy text']]);
  });

  test('parses tool_use from content_block_start', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
          },
        },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onToolStart.length).toBe(1);
    expect(callbacks.calls.onToolStart[0][0]).toMatchObject({
      id: 'tool-1',
      name: 'Read',
      friendly: 'Reading file',
    });
  });

  test('parses tool_use from assistant message with input', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-2',
              name: 'Read',
              input: { file_path: '/path/to/file.ts' },
            },
          ],
        },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onToolStart.length).toBe(1);
    expect(callbacks.calls.onToolStart[0][0]).toMatchObject({
      id: 'tool-2',
      name: 'Read',
      friendly: 'Reading file.ts',
      inputDetail: '/path/to/file.ts',
    });
  });

  test('parses TodoWrite and emits todo_update', async () => {
    const callbacks = createMockCallbacks();
    const todos = [
      { content: 'Task 1', status: 'pending' },
      { content: 'Task 2', status: 'completed' },
    ];
    const reader = createMockReader([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-3',
              name: 'TodoWrite',
              input: { todos },
            },
          ],
        },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onTodoUpdate).toEqual([[todos]]);
  });

  test('parses tool_result from user message', async () => {
    const callbacks = createMockCallbacks();
    // First, start a tool
    const reader = createMockReader([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tool-4',
            name: 'Read',
          },
        },
      },
      {
        type: 'user',
        tool_use_result: {
          content: [{ type: 'text', text: 'file content here' }],
        },
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-4',
            },
          ],
        },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onToolEnd.length).toBe(1);
    expect(callbacks.calls.onToolEnd[0][0]).toMatchObject({
      id: 'tool-4',
      name: 'Read',
    });
  });

  test('parses result event', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([{ type: 'result', result: 'success' }]);

    await parseClaudeStream(reader, callbacks, () => false);

    expect(callbacks.calls.onComplete).toEqual([['success']]);
  });

  test('handles abort signal', async () => {
    const callbacks = createMockCallbacks();
    let readCount = 0;
    const encoder = new TextEncoder();

    const reader = {
      read: async () => {
        readCount++;
        if (readCount === 1) {
          return {
            done: false,
            value: encoder.encode(
              JSON.stringify({
                type: 'stream_event',
                event: {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: 'Hello' },
                },
              }) + '\n'
            ),
          };
        }
        // Return more data that should be ignored
        return {
          done: false,
          value: encoder.encode(
            JSON.stringify({
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: ' world' },
              },
            }) + '\n'
          ),
        };
      },
      releaseLock: () => {},
      cancel: async () => {},
      closed: Promise.resolve(undefined),
    } as ReadableStreamDefaultReader<Uint8Array>;

    // Abort after first read
    let aborted = false;
    await parseClaudeStream(reader, callbacks, () => {
      if (readCount >= 1) {
        aborted = true;
      }
      return aborted;
    });

    expect(callbacks.calls.onError).toEqual([['Request cancelled']]);
  });

  test('handles malformed JSON gracefully', async () => {
    const callbacks = createMockCallbacks();
    const encoder = new TextEncoder();

    const reader = {
      read: async () => {
        return {
          done: false,
          value: encoder.encode('not valid json\n'),
        };
      },
      releaseLock: () => {},
      cancel: async () => {},
      closed: Promise.resolve(undefined),
      _done: false,
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    // Override to complete after first read
    let readCount = 0;
    (reader as { read: () => Promise<{ done: boolean; value?: Uint8Array }> }).read = async () => {
      readCount++;
      if (readCount > 1) {
        return { done: true, value: undefined };
      }
      return {
        done: false,
        value: encoder.encode('not valid json\n'),
      };
    };

    await parseClaudeStream(reader, callbacks, () => false);

    // Should not throw, should not call any callbacks
    expect(callbacks.calls.onError).toEqual([]);
    expect(callbacks.calls.onText).toEqual([]);
  });

  test('deduplicates tool_start events', async () => {
    const callbacks = createMockCallbacks();
    const reader = createMockReader([
      // Early detection from content_block_start
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tool-dup',
            name: 'Read',
          },
        },
      },
      // Same tool from assistant message
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-dup',
              name: 'Read',
              input: { file_path: '/file.ts' },
            },
          ],
        },
      },
    ]);

    await parseClaudeStream(reader, callbacks, () => false);

    // Should only emit tool_start once
    expect(callbacks.calls.onToolStart.length).toBe(1);
  });
});
