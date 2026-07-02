export type SetupGateDecision = 'children' | 'spinner' | 'redirect';

export interface SetupGateInput {
  pathname: string;
  providersReady: boolean;
  agentsReady: boolean;
  providerCount: number;
  agentCount: number;
  setupComplete: boolean;
}

export function resolveSetupGate(input: SetupGateInput): SetupGateDecision {
  if (input.pathname === '/setup') return 'children';

  const resolved = input.providersReady && input.agentsReady;
  if (!resolved) {
    return input.setupComplete ? 'children' : 'spinner';
  }

  const hasSetup = input.providerCount > 0 && input.agentCount > 0;
  return hasSetup ? 'children' : 'redirect';
}
