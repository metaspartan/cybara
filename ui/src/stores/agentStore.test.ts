import { beforeEach, describe, expect, test } from 'bun:test';
import { useAgentStore } from './agentStore';
import type { Agent } from '@/types';

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: `agent-${id}`,
    ...overrides,
  } as Agent;
}

beforeEach(() => {
  useAgentStore.setState({
    agents: [],
    selectedAgent: null,
    isLoading: false,
    error: null,
  });
});

describe('useAgentStore', () => {
  test('setAgents replaces the list', () => {
    const list = [makeAgent('a'), makeAgent('b')];
    useAgentStore.getState().setAgents(list);
    expect(useAgentStore.getState().agents).toEqual(list);

    useAgentStore.getState().setAgents([makeAgent('c')]);
    expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['c']);
  });

  test('addAgent appends without dropping existing agents', () => {
    useAgentStore.getState().addAgent(makeAgent('a'));
    useAgentStore.getState().addAgent(makeAgent('b'));
    expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['a', 'b']);
  });

  test('updateAgent merges partial updates into the matching agent only', () => {
    useAgentStore.getState().setAgents([makeAgent('a'), makeAgent('b')]);
    useAgentStore.getState().updateAgent('a', { name: 'renamed' } as Partial<Agent>);

    const agents = useAgentStore.getState().agents;
    expect(agents.find((a) => a.id === 'a')?.name).toBe('renamed');
    expect(agents.find((a) => a.id === 'b')?.name).toBe('agent-b');
  });

  test('updateAgent with an unknown id is a no-op', () => {
    const list = [makeAgent('a')];
    useAgentStore.getState().setAgents(list);
    useAgentStore.getState().updateAgent('zzz', { name: 'ghost' } as Partial<Agent>);
    expect(useAgentStore.getState().agents).toEqual(list);
  });

  test('removeAgent drops only the matching agent', () => {
    useAgentStore.getState().setAgents([makeAgent('a'), makeAgent('b'), makeAgent('c')]);
    useAgentStore.getState().removeAgent('b');
    expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['a', 'c']);

    useAgentStore.getState().removeAgent('nope');
    expect(useAgentStore.getState().agents.map((a) => a.id)).toEqual(['a', 'c']);
  });

  test('removeAgent does not clear a selected agent pointing at the removed id', () => {
    const doomed = makeAgent('a');
    useAgentStore.getState().setAgents([doomed]);
    useAgentStore.getState().setSelectedAgent(doomed);
    useAgentStore.getState().removeAgent('a');
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useAgentStore.getState().selectedAgent).toEqual(doomed);
  });

  test('setSelectedAgent sets and clears the selection', () => {
    const agent = makeAgent('a');
    useAgentStore.getState().setSelectedAgent(agent);
    expect(useAgentStore.getState().selectedAgent).toEqual(agent);

    useAgentStore.getState().setSelectedAgent(null);
    expect(useAgentStore.getState().selectedAgent).toBeNull();
  });

  test('setLoading and setError track request state', () => {
    useAgentStore.getState().setLoading(true);
    useAgentStore.getState().setError('boom');
    expect(useAgentStore.getState().isLoading).toBe(true);
    expect(useAgentStore.getState().error).toBe('boom');

    useAgentStore.getState().setLoading(false);
    useAgentStore.getState().setError(null);
    expect(useAgentStore.getState().isLoading).toBe(false);
    expect(useAgentStore.getState().error).toBeNull();
  });
});
