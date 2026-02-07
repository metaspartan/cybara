export interface Agent {
  id: string;
  name: string;
  description?: string;
  model: string;
  provider: string;
  type?: string;
  status?: 'active' | 'inactive' | 'idle' | 'running' | 'stopped';
  systemPrompt?: string;
  system_prompt?: string;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
  tools?: string[];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_call_id?: string;
}

export interface Provider {
  id: string;
  name: string;
  type?: string;
  provider?: string;
  description?: string;
  baseUrl?: string;
  base_url?: string;
  apiKey?: string;
  api_key?: string;
  accessToken?: string;
  access_token?: string;
  models: string[];
  isDefault?: boolean;
  is_default?: boolean;
  config?: Record<string, unknown>;
  authType?: 'none' | 'bearer' | 'token';
  createdAt?: string;
  created_at?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: 'telegram' | 'discord' | 'slack' | 'webhook';
  config: Record<string, unknown>;
  enabled?: boolean;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
}

export interface ChannelField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  required?: boolean;
  description?: string;
  options?: string[];
}

export interface Memory {
  id?: string;
  file?: string;
  content: string;
  type?: 'user' | 'agent' | 'system';
  agentId?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  entries?: MemoryEntry[];
  date?: string;
  index?: number;
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  agent_id?: string;
  action?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'active' | 'paused';
  enabled?: boolean;
  schedule?: string;
  lastRun?: string;
  last_run?: string;
  nextRun?: string;
  next_run?: string;
  createdAt?: string;
  created_at?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  code?: string;
  language?: string;
  category?: string;
  parameters?: SkillParameter[];
  enabled?: boolean;
  location?: string;
  createdAt?: string;
  created_at?: string;
}

export interface SkillParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>; // Alias for compatibility
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'success' | 'error';
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
}

export interface ChatSession {
  id: string;
  agentId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AvailableProvider {
  id: string;
  name: string;
  description: string;
  models: string[];
  authType?: 'none' | 'api_key' | 'bearer' | 'token' | 'oauth' | 'aws-sdk';
  oauthFlow?: 'device_code' | 'redirect' | null;
  hasOAuthConfig?: boolean;
  oauthLoginUrl?: string | null;
}

export interface AvailableChannel {
  id: string;
  name: string;
  description: string;
  icon?: string;
  fields?: ChannelField[];
}

export interface Session {
  id: string;
  agentId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id?: string;
  file?: string;
  content: string;
  index?: number;
  date?: string;
  timestamp?: string;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface DashboardStats {
  totalAgents: number;
  totalChannels: number;
  totalMemories: number;
  totalTasks: number;
  activeProviders: number;
  recentActivity: {
    type: string;
    description: string;
    timestamp: string;
  }[];
}

export interface HealthStatus {
  status: string;
  uptime?: number;
  memory?: {
    heapUsed: number;
    heapTotal: number;
  };
  checks?: Record<string, { status: string; error?: string }>;
}

export interface Tool {
  name: string;
  description: string;
  category: string;
  input_schema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  permissions?: string[];
}

export interface SystemInfo {
  name: string;
  version: string;
  setupComplete?: boolean;
  setup_complete?: boolean;
  stats?: {
    agents: { total: number };
    providers: { total: number };
    channels: { total: number };
    tasks: { total: number };
  };
}
