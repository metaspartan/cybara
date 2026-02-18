import { useState, useRef, useEffect } from 'react';
import {
  Send, Bot, User, Trash2, Wrench, Sparkles, ChevronDown, ChevronUp,
  Zap, Plus, Square, Loader2, MessageSquare, RefreshCw, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChat, useSessions, useDeleteSession, useLoadSession } from '@/hooks/useChat';
import { useAgents, useSubagents, useSpawnSubagent, useKillSubagent, type Subagent } from '@/hooks/useApi';
import { PageLayout } from '@/components/layout';
import { GlassCard, GlassButton, Input, Badge, Modal } from '@/components/ui';
import { formatRelativeTime } from '@/lib/utils';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'success' | 'error';
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  tool_calls?: ToolCall[];
  thinking?: string;
  subagent_calls?: {
    id: string;
    task: string;
    status: string;
  }[];
}

function SubagentCallItem({ subagent }: { subagent: { id: string; task: string; status: string } }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    running: { color: 'text-amber-400 border-amber-500/30 bg-amber-500/10', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', icon: <div className="w-2 h-2 rounded-full bg-emerald-400" /> },
    failed: { color: 'text-red-400 border-red-500/30 bg-red-500/10', icon: <div className="w-2 h-2 rounded-full bg-red-400" /> },
    killed: { color: 'text-gray-400 border-gray-500/30 bg-gray-500/10', icon: <div className="w-2 h-2 rounded-full bg-gray-400" /> },
  };

  const config = statusConfig[subagent.status as keyof typeof statusConfig] || statusConfig.running;

  return (
    <div className={`rounded-lg border ${config.color} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm"
      >
        {config.icon}
        <Zap className="w-3 h-3" />
        <span className="font-medium truncate">Subagent: {subagent.task.slice(0, 50)}...</span>
        <span className="flex-1" />
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/10">
          <div className="mt-2">
            <p className="text-xs text-gray-500 mb-1">Task:</p>
            <p className="text-sm text-gray-300">{subagent.task}</p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-xs text-gray-500">ID: <code className="text-gray-400">{subagent.id}</code></p>
            <Badge variant={subagent.status === 'completed' ? 'success' : subagent.status === 'failed' ? 'error' : 'default'} size="sm">
              {subagent.status}
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallItem({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcons = {
    pending: <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />,
    success: <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/30 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /></div>,
    error: <div className="w-3.5 h-3.5 rounded-full bg-red-500/30 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-red-400" /></div>,
  };

  const statusStyles = {
    pending: 'bg-amber-500/5 border border-white/[0.06] text-amber-300',
    success: 'bg-emerald-500/5 border border-white/[0.06] text-emerald-300',
    error: 'bg-red-500/5 border border-white/[0.06] text-red-300',
  };

  return (
    <div className={`rounded-lg backdrop-blur-sm overflow-hidden ${statusStyles[tool.status]}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-xs cursor-pointer hover:bg-white/5 transition-colors"
      >
        {statusIcons[tool.status]}
        <Wrench className="w-3 h-3 opacity-60" />
        <span className="font-medium truncate">{tool.name}</span>
        <span className="flex-1" />
        {expanded ? <ChevronUp className="w-3.5 h-3.5 opacity-50" /> : <ChevronDown className="w-3.5 h-3.5 opacity-50" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/5">
          <div className="mt-2">
            <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Arguments</p>
            <pre className="text-[11px] text-gray-400 bg-black/40 rounded-md p-2 overflow-x-auto">
              {JSON.stringify(tool.arguments, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div className="mt-2">
              <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Result</p>
              <pre className="text-[11px] text-gray-400 bg-black/40 rounded-md p-2 overflow-x-auto max-h-40">
                {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        <span>Thinking</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-sm text-gray-400 whitespace-pre-wrap">{thinking}</p>
        </div>
      )}
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children, ...props }: any) => (
            <pre className="bg-black/40 rounded-lg p-3 overflow-x-auto my-2" {...props}>
              {children}
            </pre>
          ),
          code({ className, children, ...props }: any) {
            if (className) {
              return <code className={className} {...props}>{children}</code>;
            }
            return (
              <code className="bg-white/10 rounded px-1.5 py-0.5 text-[0.85em] font-mono" {...props}>
                {children}
              </code>
            );
          },
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-bold mb-2">{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} className="text-indigo-400 hover:text-indigo-300 underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500 pl-3 my-2 text-gray-400">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="border-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-4" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function SubagentPanel({
  isOpen,
  onClose,
  onViewSession,
}: {
  isOpen: boolean;
  onClose: () => void;
  onViewSession?: (sessionKey: string) => void;
}) {
  const { data: subagents, isLoading, refetch } = useSubagents();
  const spawnSubagent = useSpawnSubagent();
  const killSubagent = useKillSubagent();
  const [newTask, setNewTask] = useState('');
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [selectedSubagent, setSelectedSubagent] = useState<Subagent | null>(null);

  const handleSpawn = async () => {
    if (!newTask.trim()) return;
    await spawnSubagent.mutateAsync({ task: newTask, label: `Task: ${newTask.slice(0, 30)}...` });
    setNewTask('');
    setShowSpawnModal(false);
    refetch();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="w-72 glass-strong border-l border-white/5 flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 accent-text" />
            <h3 className="text-sm font-medium text-white">Subagents</h3>
            {subagents && subagents.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">
                {subagents.length}
              </span>
            )}
          </div>
          <div className="flex items-center">
            <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowSpawnModal(true)} className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading...</p>
            </div>
          ) : subagents?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No active subagents</p>
              <button
                onClick={() => setShowSpawnModal(true)}
                className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Spawn New
              </button>
            </div>
          ) : (
            subagents?.map((subagent: Subagent) => (
              <div
                key={subagent.id}
                className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/15 transition-all cursor-pointer group"
                onClick={() => setSelectedSubagent(subagent)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white truncate font-medium">{subagent.label}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {new Date(subagent.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={
                        subagent.status === 'completed' ? 'success' :
                          subagent.status === 'failed' ? 'error' :
                            subagent.status === 'killed' ? 'default' : 'default'
                      }
                      size="sm"
                    >
                      {subagent.status}
                    </Badge>
                    {subagent.status === 'running' && (
                      <button
                        className="p-1 rounded hover:bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          killSubagent.mutateAsync(subagent.id).then(() => refetch());
                        }}
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        isOpen={showSpawnModal}
        onClose={() => setShowSpawnModal(false)}
        title="Spawn Subagent"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Task Description</label>
            <textarea
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Describe the task for the subagent..."
              className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <GlassButton variant="ghost" onClick={() => setShowSpawnModal(false)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleSpawn}
              disabled={!newTask.trim() || spawnSubagent.isPending}
            >
              {spawnSubagent.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
              Spawn Subagent
            </GlassButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!selectedSubagent}
        onClose={() => setSelectedSubagent(null)}
        title={selectedSubagent?.label || "Subagent Details"}
        size="lg"
      >
        {selectedSubagent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <Badge
                  variant={
                    selectedSubagent.status === 'completed' ? 'success' :
                      selectedSubagent.status === 'failed' ? 'error' :
                        selectedSubagent.status === 'running' ? 'default' : 'default'
                  }
                >
                  {selectedSubagent.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Created</p>
                <p className="text-sm text-white">{new Date(selectedSubagent.createdAt).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">Task</p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedSubagent.task}</p>
              </div>
            </div>

            {selectedSubagent.result && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Result</p>
                <div className={`p-3 rounded-lg border ${selectedSubagent.status === 'completed'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-red-500/10 border-red-500/30'
                  }`}>
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
                    {typeof selectedSubagent.result === 'string'
                      ? selectedSubagent.result
                      : JSON.stringify(selectedSubagent.result, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-gray-500 mb-1">Session Key</p>
              <code className="text-xs text-amber-400 bg-black/30 px-2 py-1 rounded">
                {selectedSubagent.sessionKey}
              </code>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">ID</p>
              <code className="text-xs text-gray-400 bg-black/30 px-2 py-1 rounded">
                {selectedSubagent.id}
              </code>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
              {onViewSession && (
                <button
                  className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
                  onClick={() => {
                    onViewSession(selectedSubagent.sessionKey);
                    setSelectedSubagent(null);
                  }}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  View Session
                </button>
              )}
              {selectedSubagent.status === 'running' && (
                <button
                  className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50"
                  onClick={async () => {
                    await killSubagent.mutateAsync(selectedSubagent.id);
                    setSelectedSubagent(null);
                    refetch();
                  }}
                  disabled={killSubagent.isPending}
                >
                  {killSubagent.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Square className="w-4 h-4 mr-2" />}
                  Kill
                </button>
              )}
              <button
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                onClick={() => setSelectedSubagent(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SessionsPanel({
  isOpen,
  onClose,
  currentSessionId,
  onLoadSession,
  onNewSession,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  onLoadSession: (sessionId: string, messages: ChatMessage[]) => void;
  onNewSession: () => void;
}) {
  const { data: sessions, isLoading, refetch } = useSessions();
  const deleteSession = useDeleteSession();
  const loadSession = useLoadSession();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);

  const handleLoadSession = async (sessionId: string) => {
    try {
      const result = await loadSession.mutateAsync(sessionId);
      if (result?.messagesList) {
        onLoadSession(sessionId, result.messagesList as ChatMessage[]);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="w-72 glass-strong border-l border-white/5 flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 accent-text" />
            <h3 className="text-sm font-medium text-white">Sessions</h3>
            {sessions && sessions.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">
                {sessions.length}
              </span>
            )}
          </div>
          <div className="flex items-center">
            <button onClick={onNewSession} className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          <button
            onClick={onNewSession}
            className="w-full p-2.5 rounded-lg bg-[rgba(var(--accent-primary),0.1)] border border-[rgba(var(--accent-primary),0.2)] hover:bg-[rgba(var(--accent-primary),0.15)] text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Session
          </button>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading...</p>
            </div>
          ) : sessions?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No sessions yet</p>
              <p className="text-[10px] mt-1 text-gray-600">Start chatting to create one</p>
            </div>
          ) : (
            sessions?.map((session) => (
              <div
                key={session.id}
                className={`p-2.5 rounded-lg transition-all cursor-pointer group ${currentSessionId === session.id
                  ? 'bg-[rgba(var(--accent-primary),0.12)] border border-[rgba(var(--accent-primary),0.3)]'
                  : 'bg-white/[0.03] border border-white/5 hover:border-white/15'
                  }`}
                onClick={() => handleLoadSession(session.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white font-medium flex items-center gap-1.5">
                      {currentSessionId === session.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      )}
                      Session {session.id.slice(0, 8)}...
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {session.message_count || 0} messages
                    </p>
                    {session.last_message && (
                      <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                        {session.last_message.content.slice(0, 40)}...
                      </p>
                    )}
                  </div>
                  <button
                    className="p-1 rounded hover:bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteModal(session.id);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        isOpen={!!showDeleteModal}
        onClose={() => setShowDeleteModal(null)}
        title="Delete Session"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            Are you sure you want to delete this session? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <GlassButton variant="ghost" onClick={() => setShowDeleteModal(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30"
              onClick={async () => {
                if (showDeleteModal) {
                  await deleteSession.mutateAsync(showDeleteModal);
                  setShowDeleteModal(null);
                }
              }}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </GlassButton>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function Chat() {
  const { data: agents = [] } = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const { messages, isLoading, sendMessage, clearChat, loadSession, sessionId } = useChat(selectedAgentId);
  const loadSessionMutation = useLoadSession();
  const [input, setInput] = useState('');
  const [showSubagentPanel, setShowSubagentPanel] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const message = input;
    setInput('');
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');

    if (sessionParam && sessionParam !== sessionId) {
      loadSessionMutation.mutateAsync(sessionParam).then((result) => {
        if (result?.messagesList) {
          loadSession(sessionParam, result.messagesList as ChatMessage[]);
          window.history.replaceState({}, '', '/chat');
        }
      }).catch((error) => {
        console.error('Failed to load session from URL:', error);
      });
    }
  }, []); // Only run on mount

  const typedMessages = messages as ChatMessage[];

  return (
    <div className="h-screen flex flex-col bg-[#050508]">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="text-sm sm:text-base font-semibold text-white">Chat</h1>
          {sessionId && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-mono">{sessionId.slice(0, 6)}...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <select
            value={selectedAgentId || ''}
            onChange={(e) => setSelectedAgentId(e.target.value || undefined)}
            className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white !outline-none focus:border-white/20 cursor-pointer"
          >
            <option value="">Default</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowSessionsPanel(!showSessionsPanel)}
            className={cn("p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer", showSessionsPanel ? "accent-text" : "text-gray-500")}
            title="Sessions"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSubagentPanel(!showSubagentPanel)}
            className={cn("p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer", showSubagentPanel ? "text-amber-400" : "text-gray-500")}
            title="Subagents"
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={clearChat}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4">
            {typedMessages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-500">
                  <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Start a conversation</p>
                  <p className="text-xs mt-1 text-gray-600">Ask questions, get help with code, or chat with your agents</p>
                </div>
              </div>
            ) : (
              typedMessages.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user'
                    ? 'bg-[rgba(var(--accent-primary),0.2)]'
                    : 'bg-emerald-500/20'
                    }`}>
                    {message.role === 'user'
                      ? <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 accent-text" />
                      : <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                    }
                  </div>
                  <div className={`max-w-[85%] sm:max-w-[75%] lg:max-w-[65%] ${message.role === 'user' ? 'text-right' : ''}`}>
                    {message.thinking && <ThinkingBlock thinking={message.thinking} />}

                    {message.subagent_calls && message.subagent_calls.length > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {message.subagent_calls.map((subagent) => (
                          <SubagentCallItem key={subagent.id} subagent={subagent} />
                        ))}
                      </div>
                    )}

                    {message.tool_calls && message.tool_calls.length > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {message.tool_calls.map((tool) => (
                          <ToolCallItem key={tool.id} tool={tool} />
                        ))}
                      </div>
                    )}

                    <div className={`rounded-xl sm:rounded-2xl px-3 py-2 sm:px-4 sm:py-3 ${message.role === 'user'
                      ? 'bg-[rgba(var(--accent-primary),0.15)] border border-[rgba(var(--accent-primary),0.2)]'
                      : 'bg-white/[0.03] border border-white/5'
                      }`}>
                      <MessageContent content={message.content} />
                    </div>

                    {message.timestamp && (
                      <p className="text-[10px] text-gray-600 mt-1.5">
                        {formatRelativeTime(message.timestamp)}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                </div>
                <div className="bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex-shrink-0 px-3 sm:px-4 py-3 border-t border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl">
            <div className="flex gap-2 sm:gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 px-3 sm:px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder-gray-500 !outline-none focus:border-white/20 transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-3 sm:px-4 py-2.5 rounded-xl accent-button disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {showSessionsPanel && (
          <SessionsPanel
            isOpen={showSessionsPanel}
            onClose={() => setShowSessionsPanel(false)}
            currentSessionId={sessionId}
            onLoadSession={(id, msgs) => {
              loadSession(id, msgs);
              setShowSessionsPanel(false);
            }}
            onNewSession={() => {
              clearChat();
              setShowSessionsPanel(false);
            }}
          />
        )}

        {showSubagentPanel && (
          <SubagentPanel
            isOpen={showSubagentPanel}
            onClose={() => setShowSubagentPanel(false)}
            onViewSession={async (sessionKey) => {
              try {
                const result = await loadSessionMutation.mutateAsync(sessionKey);
                if (result?.messagesList) {
                  loadSession(sessionKey, result.messagesList as ChatMessage[]);
                  setShowSubagentPanel(false);
                }
              } catch (error) {
                console.error('Failed to load subagent session:', error);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
