interface ScopedTask {
  agent_id?: string;
  session_id?: string | null;
}

export function taskMatchesScope(task: ScopedTask, agentId: string, sessionId: string): boolean {
  return (
    !agentId || task.agent_id === agentId || (Boolean(sessionId) && task.session_id === sessionId)
  );
}
