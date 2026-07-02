import { describe, expect, test } from 'bun:test';
import {
  buildActivitiesFromToolCalls,
  mergeActivityLists,
  finalizeCompletedActivities,
  normalizeActivityTextForPhase,
  type LiveActivityItem,
  type ToolCallLike,
} from './chatActivities';

const identityIntent = (name: string, _args: Record<string, unknown>, phase: string) =>
  `${phase}:${name}`;

function activity(partial: Partial<LiveActivityItem>): LiveActivityItem {
  return {
    id: partial.id ?? 'id',
    phase: partial.phase ?? 'result',
    text: partial.text ?? 'text',
    timestamp: partial.timestamp ?? 0,
    toolName: partial.toolName,
    toolCallId: partial.toolCallId,
    sandboxProvider: partial.sandboxProvider,
  };
}

describe('normalizeActivityTextForPhase', () => {
  test('result phase converts progressive verbs to past tense', () => {
    expect(normalizeActivityTextForPhase('Exploring foo', 'result')).toBe('Explored foo');
    expect(normalizeActivityTextForPhase('Running cmd', 'result')).toBe('Ran cmd');
    expect(normalizeActivityTextForPhase('Writing file', 'result')).toBe('Edited file');
    expect(normalizeActivityTextForPhase('Editing file', 'result')).toBe('Edited file');
  });

  test('error phase converts verbs to failure phrasing', () => {
    expect(normalizeActivityTextForPhase('Exploring foo', 'error')).toBe('Read failed foo');
    expect(normalizeActivityTextForPhase('Running cmd', 'error')).toBe('Command failed cmd');
  });

  test('start phase is left untouched', () => {
    expect(normalizeActivityTextForPhase('Exploring foo', 'start')).toBe('Exploring foo');
  });
});

describe('buildActivitiesFromToolCalls', () => {
  test('empty or undefined input yields empty array', () => {
    expect(buildActivitiesFromToolCalls(undefined, identityIntent)).toEqual([]);
    expect(buildActivitiesFromToolCalls([], identityIntent)).toEqual([]);
  });

  test('maps status to phase', () => {
    const calls: ToolCallLike[] = [
      { id: 'a', name: 'read', status: 'pending' },
      { id: 'b', name: 'read', status: 'completed' },
      { id: 'c', name: 'read', status: 'failed' },
    ];
    const result = buildActivitiesFromToolCalls(calls, identityIntent);
    expect(result.map((r) => r.phase)).toEqual(['start', 'result', 'error']);
  });

  test('assigns id from tool call id, falls back to index+name', () => {
    const calls: ToolCallLike[] = [
      { id: 'x1', name: 'read', status: 'completed' },
      { name: 'grep', status: 'completed' },
    ];
    const result = buildActivitiesFromToolCalls(calls, identityIntent);
    expect(result[0].id).toBe('tool-x1');
    expect(result[1].id).toBe('tool-1-grep');
  });

  test('skips calls whose text is empty', () => {
    const emptyIntent = () => '   ';
    const calls: ToolCallLike[] = [{ id: 'a', name: 'read', status: 'completed' }];
    expect(buildActivitiesFromToolCalls(calls, emptyIntent)).toEqual([]);
  });

  test('summarizes write result into an Edited summary', () => {
    const calls: ToolCallLike[] = [
      {
        id: 'w',
        name: 'write',
        status: 'completed',
        result: { change: { path: '/a/b/foo.ts', addedLines: 3, removedLines: 1 } },
      },
    ];
    const result = buildActivitiesFromToolCalls(calls, identityIntent);
    expect(result[0].text).toBe('Edited foo.ts +3 -1');
  });

  test('summarizes grep result into an Explored summary with pluralization', () => {
    const one: ToolCallLike[] = [
      { id: 'g', name: 'grep', status: 'completed', result: { files: ['a'] } },
    ];
    const many: ToolCallLike[] = [
      { id: 'g', name: 'grep', status: 'completed', result: { count: 4 } },
    ];
    expect(buildActivitiesFromToolCalls(one, identityIntent)[0].text).toBe('Explored 1 file, 1 search');
    expect(buildActivitiesFromToolCalls(many, identityIntent)[0].text).toBe('Explored 4 files, 1 search');
  });

  test('uses started_at when present, else timeline_index, else base+index', () => {
    const calls: ToolCallLike[] = [
      { id: 'a', name: 'read', status: 'completed', started_at: 5000 },
      { id: 'b', name: 'read', status: 'completed', timeline_index: 7 },
      { id: 'c', name: 'read', status: 'completed' },
    ];
    const result = buildActivitiesFromToolCalls(calls, identityIntent, { baseTimestampMs: 100 });
    expect(result[0].timestamp).toBe(5000);
    expect(result[1].timestamp).toBe(107);
    expect(result[2].timestamp).toBe(102);
  });

  test('parses string started_at as epoch or date', () => {
    const calls: ToolCallLike[] = [
      { id: 'a', name: 'read', status: 'completed', started_at: '1500' },
    ];
    expect(buildActivitiesFromToolCalls(calls, identityIntent)[0].timestamp).toBe(1500);
  });

  test('extracts a known sandbox provider from result', () => {
    const calls: ToolCallLike[] = [
      { id: 'a', name: 'read', status: 'completed', result: { sandboxProvider: 'PODMAN' } },
      { id: 'b', name: 'read', status: 'completed', result: { sandbox_provider: 'nope' } },
    ];
    const result = buildActivitiesFromToolCalls(calls, identityIntent);
    expect(result[0].sandboxProvider).toBe('podman');
    expect(result[1].sandboxProvider).toBeUndefined();
  });
});

describe('mergeActivityLists', () => {
  test('two empty lists merge to empty', () => {
    expect(mergeActivityLists([], [])).toEqual([]);
  });

  test('dedupes by exact toolCallId+phase key', () => {
    const a = activity({ id: '1', toolCallId: 'tc', phase: 'result', text: 'x' });
    const b = activity({ id: '2', toolCallId: 'tc', phase: 'result', text: 'y' });
    const merged = mergeActivityLists([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('1');
  });

  test('keeps distinct toolCallId entries', () => {
    const a = activity({ id: '1', toolCallId: 'tc1', phase: 'result' });
    const b = activity({ id: '2', toolCallId: 'tc2', phase: 'result' });
    expect(mergeActivityLists([a], [b])).toHaveLength(2);
  });

  test('drops a start activity when a later completion exists for the same toolCallId', () => {
    const start = activity({ id: 's', toolCallId: 'tc', phase: 'start', timestamp: 10 });
    const done = activity({ id: 'd', toolCallId: 'tc', phase: 'result', timestamp: 20 });
    const merged = mergeActivityLists([start], [done]);
    expect(merged).toHaveLength(1);
    expect(merged[0].phase).toBe('result');
  });

  test('keeps a start activity when its completion is earlier (out of order)', () => {
    const done = activity({ id: 'd', toolCallId: 'tc', phase: 'result', timestamp: 5 });
    const start = activity({ id: 's', toolCallId: 'tc', phase: 'start', timestamp: 20 });
    const merged = mergeActivityLists([start], [done]);
    expect(merged.map((m) => m.phase).sort()).toEqual(['result', 'start']);
  });

  test('preserves primary-then-secondary ordering for unique items', () => {
    const a = activity({ id: 'a', toolCallId: 'x', phase: 'result', timestamp: 1 });
    const b = activity({ id: 'b', toolCallId: 'y', phase: 'result', timestamp: 2 });
    const merged = mergeActivityLists([a], [b]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });

  test('semantic dedup drops same-second duplicate without toolCallId', () => {
    const a = activity({ id: 'a', phase: 'result', toolName: 'read', text: 'Explored foo', timestamp: 1000 });
    const b = activity({ id: 'b', phase: 'result', toolName: 'read', text: 'Explored foo', timestamp: 1500 });
    const merged = mergeActivityLists([a], [b]);
    expect(merged).toHaveLength(1);
  });
});

describe('finalizeCompletedActivities', () => {
  test('promotes start activities to result and normalizes text', () => {
    const start = activity({ id: 's', toolCallId: 'tc', phase: 'start', text: 'Exploring foo', timestamp: 1 });
    const result = finalizeCompletedActivities([start]);
    expect(result).toHaveLength(1);
    expect(result[0].phase).toBe('result');
    expect(result[0].text).toBe('Explored foo');
  });

  test('leaves already-completed activities unchanged in phase', () => {
    const done = activity({ id: 'd', toolCallId: 'tc', phase: 'result', text: 'Explored foo', timestamp: 1 });
    const result = finalizeCompletedActivities([done]);
    expect(result[0].phase).toBe('result');
    expect(result[0].text).toBe('Explored foo');
  });

  test('empty input yields empty output', () => {
    expect(finalizeCompletedActivities([])).toEqual([]);
  });
});
