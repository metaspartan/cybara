import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Search,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Clock,
  Bot,
  User,
  Wrench,
  X,
  MoreVertical,
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PageLayout } from '@/components/layout';
import { sessionsApi } from '@/lib/api';
import type { ChatMessage, ToolCallInfo } from '@/types';

interface Session {
  id: string;
  agent_id: string;
  messages?: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: {
    role: string;
    content: string;
  };
}

interface SessionWithMessages extends Session {
  messagesList: ChatMessage[];
}

const roleIcons: Record<string, React.ReactNode> = {
  user: <User className="w-4 h-4 text-indigo-400" />,
  assistant: <Bot className="w-4 h-4 text-emerald-400" />,
  system: <Wrench className="w-4 h-4 text-gray-400" />,
  tool: <Wrench className="w-4 h-4 text-amber-400" />,
};

export function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<SessionWithMessages | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const response = await sessionsApi.list();
      if (response.success) {
        setSessions(response.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleViewSession = async (session: Session) => {
    try {
      const response = await sessionsApi.get(session.id);
      if (response.success) {
        setSelectedSession(response.data as SessionWithMessages);
        setIsViewModalOpen(true);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return;

    try {
      await sessionsApi.delete(sessionToDelete.id);
      setSessions(sessions.filter(s => s.id !== sessionToDelete.id));
      setIsDeleteModalOpen(false);
      setSessionToDelete(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const filteredSessions = sessions.filter(session =>
    session.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    session.agent_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <PageLayout
      title="Sessions"
      subtitle="View and manage chat sessions"
      actions={
        <Button variant="ghost" size="sm" onClick={fetchSessions} leftIcon={<RefreshCw className="w-4 h-4" />}>
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Search */}
        <Card>
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <Input
                placeholder="Search sessions by ID or agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sessions List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-gray-500" />
          </div>
        ) : filteredSessions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <h3 className="text-lg font-medium text-white mb-2">No sessions found</h3>
              <p className="text-gray-400">Sessions will appear here when agents start chatting</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredSessions.map((session) => (
              <Card key={session.id} className="hover:border-white/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <MessageSquare className="w-5 h-5 text-indigo-400" />
                        <h3 className="font-medium text-white truncate">
                          Session {session.id.slice(0, 8)}...
                        </h3>
                        <Badge variant="info" size="sm">
                          {session.message_count || 0} messages
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        <span className="flex items-center gap-1">
                          <Bot className="w-4 h-4" />
                          Agent: {session.agent_id.slice(0, 8)}...
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {new Date(session.updated_at).toLocaleString()}
                        </span>
                      </div>

                      {session.last_message && (
                        <p className="mt-2 text-sm text-gray-500 truncate">
                          Last: <span className="capitalize">{session.last_message.role}</span>: {session.last_message.content.slice(0, 100)}
                          {session.last_message.content.length > 100 && '...'}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewSession(session)}
                        leftIcon={<ChevronRight className="w-4 h-4" />}
                      >
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4 text-red-400" />}
                        onClick={() => {
                          setSessionToDelete(session);
                          setIsDeleteModalOpen(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* View Session Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setSelectedSession(null);
        }}
        title={`Session ${selectedSession?.id.slice(0, 12)}...`}
        size="xl"
      >
        {selectedSession && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Session Info */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-white/5 text-sm">
              <span className="text-gray-400">Agent:</span>
              <code className="text-white">{selectedSession.agent_id}</code>
              <span className="text-gray-400 ml-4">Created:</span>
              <span className="text-white">{new Date(selectedSession.created_at).toLocaleString()}</span>
            </div>

            {/* Messages */}
            <div className="space-y-3">
              {selectedSession.messagesList?.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-3 p-3 rounded-xl ${message.role === 'user'
                    ? 'bg-indigo-500/10'
                    : message.role === 'assistant'
                      ? 'bg-emerald-500/10'
                      : message.role === 'tool'
                        ? 'bg-amber-500/10'
                        : 'bg-white/5'
                    }`}
                >
                  <div className="flex-shrink-0 mt-1">
                    {roleIcons[message.role] || <MessageSquare className="w-4 h-4 text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-400 capitalize">
                        {message.role}
                      </span>
                      {message.timestamp && (
                        <span className="text-xs text-gray-500">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                      )}
                      {message.tool_calls && message.tool_calls.length > 0 && (
                        <Badge variant="warning" size="sm" className="flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {message.tool_calls.length} tool{message.tool_calls.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-white whitespace-pre-wrap">{message.content}</p>

                    {/* Tool Calls Display */}
                    {message.tool_calls && message.tool_calls.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {message.tool_calls.map((tc, tcIndex) => (
                          <div
                            key={tc.id || tcIndex}
                            className="p-2 rounded-lg bg-black/30 border border-white/10"
                          >
                            <div className="flex items-center gap-2">
                              {tc.status === 'completed' || tc.status === 'success' ? (
                                <CheckCircle className="w-4 h-4 text-emerald-400" />
                              ) : tc.status === 'failed' || tc.status === 'error' ? (
                                <XCircle className="w-4 h-4 text-red-400" />
                              ) : tc.status === 'executing' ? (
                                <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-amber-400" />
                              )}
                              <code className="text-sm font-mono text-amber-300">{tc.name}</code>
                              {tc.duration && (
                                <span className="text-xs text-gray-500">{tc.duration}ms</span>
                              )}
                              <Badge
                                size="sm"
                                variant={(tc.status === 'completed' || tc.status === 'success') ? 'success' : (tc.status === 'failed' || tc.status === 'error') ? 'error' : 'default'}
                              >
                                {tc.status}
                              </Badge>
                            </div>
                            {tc.error && (
                              <p className="mt-1 text-xs text-red-400">{tc.error}</p>
                            )}
                            {tc.result && (
                              <pre className="mt-2 text-xs text-gray-400 overflow-auto max-h-24 bg-black/20 p-2 rounded">
                                {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2).slice(0, 500)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {(!selectedSession.messagesList || selectedSession.messagesList.length === 0) && (
              <div className="text-center py-8 text-gray-500">
                No messages in this session
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSessionToDelete(null);
        }}
        title="Delete Session"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            Are you sure you want to delete this session? This action cannot be undone.
          </p>
          {sessionToDelete && (
            <div className="p-3 rounded-lg bg-white/5 text-sm">
              <p><span className="text-gray-400">Session ID:</span> {sessionToDelete.id}</p>
              <p><span className="text-gray-400">Messages:</span> {sessionToDelete.message_count || 0}</p>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setSessionToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={<Trash2 className="w-4 h-4" />}
              onClick={handleDeleteSession}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
