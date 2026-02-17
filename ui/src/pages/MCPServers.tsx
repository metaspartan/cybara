import { useState, useEffect } from 'react';
import {
    Server,
    Search,
    Plus,
    Play,
    Square,
    RefreshCw,
    Trash2,
    Package,
    CheckCircle,
    XCircle,
    Download,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PageLayout } from '@/components/layout';
import { useUIStore } from '../stores/uiStore';
import { mcpApi, type MCPRegistryServer, type MCPServer } from '@/lib/api';

export function MCPServers() {
    const [tab, setTab] = useState<'installed' | 'registry'>('installed');
    const [servers, setServers] = useState<MCPServer[]>([]);
    const [registryServers, setRegistryServers] = useState<MCPRegistryServer[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const { addToast } = useUIStore();

    // Load installed servers
    const loadServers = async () => {
        setLoading(true);
        try {
            const result = await mcpApi.list();
            if (!result.success || !Array.isArray(result.data)) {
                throw new Error(result.error || 'Failed to load MCP servers');
            }
            setServers(result.data);
        } catch {
            addToast('error', 'Failed to load MCP servers');
        } finally {
            setLoading(false);
        }
    };

    // Load registry
    const loadRegistry = async () => {
        setLoading(true);
        try {
            if (searchQuery) {
                const result = await mcpApi.search(searchQuery);
                if (!result.success || !Array.isArray(result.data)) {
                    throw new Error(result.error || 'Failed to load registry');
                }
                setRegistryServers(result.data);
            } else {
                const result = await mcpApi.popular();
                if (!result.success || !Array.isArray(result.data)) {
                    throw new Error(result.error || 'Failed to load registry');
                }
                setRegistryServers(result.data);
            }
        } catch {
            addToast('error', 'Failed to load registry');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (tab === 'installed') {
            loadServers();
        } else {
            loadRegistry();
        }
    }, [tab]);

    useEffect(() => {
        if (tab === 'registry') {
            const timeout = setTimeout(() => loadRegistry(), 300);
            return () => clearTimeout(timeout);
        }
    }, [searchQuery]);

    const handleStart = async (id: string) => {
        const result = await mcpApi.start(id);
        if (result.success && result.data?.success) {
            addToast('success', 'Server started');
            loadServers();
        } else {
            addToast('error', result.error || result.data?.error || 'Failed to start');
        }
    };

    const handleStop = async (id: string) => {
        const result = await mcpApi.stop(id);
        if (result.success && result.data?.success) {
            addToast('info', 'Server stopped');
            loadServers();
        } else {
            addToast('error', result.error || result.data?.error || 'Failed to stop');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this MCP server?')) return;
        const result = await mcpApi.delete(id);
        if (result.success && result.data?.success) {
            addToast('success', 'Server deleted');
            loadServers();
        } else {
            addToast('error', result.error || 'Failed to delete server');
        }
    };

    const handleInstall = async (server: MCPRegistryServer) => {
        addToast('info', `Installing ${server.name}...`);
        const result = await mcpApi.install({ id: server.id });
        if (result.success && result.data?.success) {
            addToast('success', `${server.name} installed!`);
            setTab('installed');
            loadServers();
        } else {
            addToast('error', result.error || result.data?.error || 'Install failed');
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'running':
                return <Badge variant="success" size="sm"><CheckCircle className="w-3 h-3 mr-1" />Running</Badge>;
            case 'starting':
                return <Badge variant="warning" size="sm"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Starting</Badge>;
            case 'error':
                return <Badge variant="error" size="sm"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
            default:
                return <Badge variant="default" size="sm">Stopped</Badge>;
        }
    };

    const getRegistryBadge = (registry: string) => {
        const colors: Record<string, string> = {
            official: 'from-indigo-500 to-violet-500',
            smithery: 'from-emerald-500 to-teal-500',
            'mcp.so': 'from-amber-500 to-orange-500',
            npm: 'from-red-500 to-pink-500',
        };
        return (
            <span className={`px-2 py-0.5 text-xs rounded-full bg-gradient-to-r ${colors[registry] || 'from-gray-500 to-gray-600'} text-white`}>
                {registry}
            </span>
        );
    };

    return (
        <PageLayout
            title="MCP Servers"
            subtitle="Model Context Protocol servers for external tools"
            actions={
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        leftIcon={<RefreshCw className="w-4 h-4" />}
                        onClick={() => tab === 'installed' ? loadServers() : loadRegistry()}
                    >
                        Refresh
                    </Button>
                    <Button
                        leftIcon={<Plus className="w-4 h-4" />}
                        onClick={() => setShowAddModal(true)}
                    >
                        Add Server
                    </Button>
                </div>
            }
        >
            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => setTab('installed')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'installed'
                        ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/20 text-white border border-indigo-500/30'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                >
                    <Server className="w-4 h-4 inline mr-2" />
                    Installed ({servers.length})
                </button>
                <button
                    onClick={() => setTab('registry')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'registry'
                        ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/20 text-white border border-indigo-500/30'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                >
                    <Package className="w-4 h-4 inline mr-2" />
                    Browse Registry
                </button>
            </div>

            {/* Search (registry only) */}
            {tab === 'registry' && (
                <div className="mb-6 relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                        placeholder="Search MCP servers..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
                </div>
            ) : tab === 'installed' ? (
                /* Installed Servers */
                <div className="grid gap-4">
                    {servers.length === 0 ? (
                        <Card className="p-12 text-center">
                            <Server className="w-12 h-12 mx-auto mb-4 text-gray-500" />
                            <h3 className="text-lg font-medium text-white mb-2">No MCP Servers Installed</h3>
                            <p className="text-gray-400 mb-4">Browse the registry to install MCP servers</p>
                            <Button onClick={() => setTab('registry')}>
                                Browse Registry
                            </Button>
                        </Card>
                    ) : (
                        servers.map((server) => (
                            <Card key={server.id} className="p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
                                            <Server className="w-5 h-5 text-indigo-400" />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-white">{server.name}</h3>
                                            <p className="text-sm text-gray-400 font-mono">{server.command} {server.args}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {getStatusBadge(server.status)}
                                        <span className="text-sm text-gray-400">{server.toolCount} tools</span>
                                        <div className="flex gap-2">
                                            {server.status === 'running' ? (
                                                <Button variant="ghost" size="sm" onClick={() => handleStop(server.id)}>
                                                    <Square className="w-4 h-4" />
                                                </Button>
                                            ) : (
                                                <Button variant="ghost" size="sm" onClick={() => handleStart(server.id)}>
                                                    <Play className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="sm" onClick={() => handleDelete(server.id)}>
                                                <Trash2 className="w-4 h-4 text-red-400" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            ) : (
                /* Registry Browser */
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {registryServers.map((server) => (
                        <Card key={server.id} className="p-4 hover:border-indigo-500/30 transition-colors">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
                                        <Package className="w-5 h-5 text-indigo-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-medium text-white">{server.name}</h3>
                                        {getRegistryBadge(server.registry)}
                                    </div>
                                </div>
                            </div>
                            <p className="text-sm text-gray-400 mb-3 line-clamp-2">{server.description}</p>
                            {server.envVars && server.envVars.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-3">
                                    {server.envVars.map((v) => (
                                        <span key={v} className="px-2 py-0.5 text-xs rounded bg-amber-500/20 text-amber-400">
                                            {v}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    className="flex-1"
                                    leftIcon={<Download className="w-4 h-4" />}
                                    onClick={() => handleInstall(server)}
                                >
                                    Install
                                </Button>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Add Server Modal */}
            <AddServerModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSuccess={() => {
                    setShowAddModal(false);
                    loadServers();
                }}
            />
        </PageLayout>
    );
}

// Add Server Modal Component
function AddServerModal({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess: () => void }) {
    const [name, setName] = useState('');
    const [command, setCommand] = useState('bunx');
    const [args, setArgs] = useState('');
    const [env, setEnv] = useState('');
    const [loading, setLoading] = useState(false);
    const { addToast } = useUIStore();

    const handleSubmit = async () => {
        if (!name || !command) {
            addToast('error', 'Name and command are required');
            return;
        }

        setLoading(true);
        try {
            const result = await mcpApi.create({
                name,
                command,
                args: args || undefined,
                env: env || undefined,
                enabled: true,
            });
            if (result.success && result.data?.id) {
                addToast('success', 'Server added!');
                onSuccess();
                setName('');
                setArgs('');
                setEnv('');
            } else {
                throw new Error(result.error || 'Failed to create');
            }
        } catch {
            addToast('error', 'Failed to add server');
        }
        setLoading(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add MCP Server">
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Server" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Command</label>
                    <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="bunx" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Arguments</label>
                    <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--bun @modelcontextprotocol/server-github" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Environment Variables</label>
                    <Input value={env} onChange={(e) => setEnv(e.target.value)} placeholder="API_KEY=xxx,OTHER=yyy" />
                </div>
                <div className="flex gap-2 pt-4">
                    <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
                    <Button onClick={handleSubmit} isLoading={loading} className="flex-1">Add Server</Button>
                </div>
            </div>
        </Modal>
    );
}
