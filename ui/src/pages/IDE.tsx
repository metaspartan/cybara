
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Highlight, themes } from 'prism-react-renderer';
import {
    Folder,
    FolderOpen,
    FileCode,
    FileText,
    FileJson,
    File,
    FilePlus,
    FolderPlus,
    ChevronRight,
    ChevronDown,
    Home,
    RefreshCw,
    Eye,
    EyeOff,
    Code,
    Loader2,
    AlertCircle,
    AlertTriangle,
    Info,
    Save,
    X,
    Edit3,
    Check,
    Zap,
    GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/auth';

interface FileEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    extension?: string;
    modifiedAt?: string;
}

interface BrowseResult {
    success: boolean;
    path: string;
    parent: string | null;
    entries: FileEntry[];
    error?: string;
}

interface ReadResult {
    success: boolean;
    path: string;
    content?: string;
    size?: number;
    extension?: string;
    isBinary?: boolean;
    error?: string;
}

interface Diagnostic {
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
    source?: string;
    code?: string | number;
}

interface LSPLanguage {
    name: string;
    available: boolean;
    bundled: boolean;
}

function getFileIcon(entry: FileEntry) {
    if (entry.type === 'directory') return null;

    const ext = entry.extension?.toLowerCase() || '';
    const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.c', '.cpp', '.h', '.hpp', '.java', '.kt', '.swift', '.rb', '.php', '.lua', '.zig'];
    const jsonExts = ['.json', '.yaml', '.yml', '.toml'];
    const textExts = ['.md', '.txt', '.log', '.env', '.sh', '.bash', '.zsh'];

    if (codeExts.includes(ext)) return <FileCode className="w-4 h-4 text-blue-400" />;
    if (jsonExts.includes(ext)) return <FileJson className="w-4 h-4 text-yellow-400" />;
    if (textExts.includes(ext)) return <FileText className="w-4 h-4 text-gray-400" />;
    return <File className="w-4 h-4 text-gray-500" />;
}

function formatSize(bytes?: number): string {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPrismLanguage(ext?: string): string {
    const map: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'tsx',
        '.js': 'javascript',
        '.jsx': 'jsx',
        '.py': 'python',
        '.rs': 'rust',
        '.go': 'go',
        '.json': 'json',
        '.md': 'markdown',
        '.css': 'css',
        '.html': 'markup',
        '.xml': 'markup',
        '.sh': 'bash',
        '.bash': 'bash',
        '.zsh': 'bash',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.toml': 'toml',
        '.sql': 'sql',
        '.c': 'c',
        '.cpp': 'cpp',
        '.h': 'c',
        '.hpp': 'cpp',
        '.java': 'java',
        '.kt': 'kotlin',
        '.swift': 'swift',
        '.rb': 'ruby',
        '.php': 'php',
        '.lua': 'lua',
    };
    return map[ext?.toLowerCase() || ''] || 'plaintext';
}

function getSeverityIcon(severity: 'error' | 'warning' | 'info') {
    switch (severity) {
        case 'error':
            return <AlertCircle className="w-3 h-3 text-red-400" />;
        case 'warning':
            return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
        default:
            return <Info className="w-3 h-3 text-blue-400" />;
    }
}

function FileTreeItem({
    entry,
    level = 0,
    isExpanded,
    onToggle,
    onSelect,
    isSelected,
}: {
    entry: FileEntry;
    level?: number;
    isExpanded?: boolean;
    onToggle?: () => void;
    onSelect: (entry: FileEntry) => void;
    isSelected: boolean;
}) {
    const isDir = entry.type === 'directory';

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md transition-colors text-sm',
                '!outline-none focus:!outline-none',
                isSelected ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'
            )}
            style={{ paddingLeft: `${level * 16 + 8}px` }}
            onClick={() => {
                if (isDir && onToggle) {
                    onToggle();
                } else {
                    onSelect(entry);
                }
            }}
        >
            {isDir ? (
                <>
                    {isExpanded ? (
                        <ChevronDown className="w-3 h-3 flex-shrink-0" />
                    ) : (
                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                    )}
                    {isExpanded ? (
                        <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    ) : (
                        <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    )}
                </>
            ) : (
                <>
                    <span className="w-3" />
                    {getFileIcon(entry)}
                </>
            )}
            <span className="truncate">{entry.name}</span>
            {!isDir && entry.size !== undefined && (
                <span className="ml-auto text-xs text-gray-600">{formatSize(entry.size)}</span>
            )}
        </div>
    );
}

function FileTree({
    path,
    level = 0,
    selectedPath,
    onSelectFile,
    expandedDirs,
    onToggleDir,
}: {
    path: string;
    level?: number;
    selectedPath: string | null;
    onSelectFile: (entry: FileEntry) => void;
    expandedDirs: Set<string>;
    onToggleDir: (path: string) => void;
}) {
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchEntries = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`);
                const data: BrowseResult = await res.json();
                if (data.success) {
                    setEntries(data.entries);
                } else {
                    setError(data.error || 'Failed to load');
                }
            } catch (e) {
                setError(String(e));
            }
            setIsLoading(false);
        };
        fetchEntries();
    }, [path]);

    if (isLoading && level === 0) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
            </div>
        );
    }

    if (error && level === 0) {
        return (
            <div className="flex items-center gap-2 p-4 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
        );
    }

    return (
        <div>
            {entries.map((entry) => {
                const isDir = entry.type === 'directory';
                const isExpanded = expandedDirs.has(entry.path);

                return (
                    <div key={entry.path}>
                        <FileTreeItem
                            entry={entry}
                            level={level}
                            isExpanded={isExpanded}
                            onToggle={() => onToggleDir(entry.path)}
                            onSelect={onSelectFile}
                            isSelected={selectedPath === entry.path}
                        />
                        {isDir && isExpanded && (
                            <FileTree
                                path={entry.path}
                                level={level + 1}
                                selectedPath={selectedPath}
                                onSelectFile={onSelectFile}
                                expandedDirs={expandedDirs}
                                onToggleDir={onToggleDir}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function CodeViewer({
    path,
    autoRefresh,
    onSaveSuccess,
}: {
    path: string | null;
    autoRefresh: boolean;
    onSaveSuccess?: () => void;
}) {
    const [content, setContent] = useState<string | null>(null);
    const [editContent, setEditContent] = useState<string>('');
    const [extension, setExtension] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastModified, setLastModified] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isBinary, setIsBinary] = useState(false);
    const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
    const [showDiagnostics, setShowDiagnostics] = useState(true);

    const fetchContent = useCallback(async () => {
        if (!path) return;

        setIsLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/api/ide/read?path=${encodeURIComponent(path)}`);
            const data: ReadResult = await res.json();
            if (data.success) {
                setContent(data.content || '');
                setEditContent(data.content || '');
                setExtension(data.extension || '');
                setIsBinary(data.isBinary || false);
                setLastModified(new Date().toLocaleTimeString());
            } else {
                setError(data.error || 'Failed to load file');
            }
        } catch (e) {
            setError(String(e));
        }
        setIsLoading(false);
    }, [path]);

    const fetchDiagnostics = useCallback(async () => {
        if (!path) return;

        try {
            const res = await apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            if (data.success && data.diagnostics) {
                setDiagnostics(data.diagnostics);
            }
        } catch {
        }
    }, [path]);

    useEffect(() => {
        setIsEditing(false);
        setDiagnostics([]);
        fetchContent();
    }, [fetchContent]);

    useEffect(() => {
        if (content !== null && path) {
            fetchDiagnostics();
        }
    }, [content, path, fetchDiagnostics]);

    useEffect(() => {
        if (!autoRefresh || !path || isEditing) return;

        const interval = setInterval(() => {
            fetchContent();
            fetchDiagnostics();
        }, 3000);
        return () => clearInterval(interval);
    }, [autoRefresh, path, fetchContent, fetchDiagnostics, isEditing]);

    const handleSave = useCallback(async () => {
        if (!path) return;

        setIsSaving(true);
        setSaveError(null);
        try {
            const res = await apiFetch('/api/ide/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: editContent }),
            });
            const data = await res.json();
            if (data.success) {
                setContent(editContent);
                setIsEditing(false);
                setLastModified(new Date().toLocaleTimeString());
                onSaveSuccess?.();
                setTimeout(fetchDiagnostics, 500);
            } else {
                setSaveError(data.error || 'Failed to save');
            }
        } catch (e) {
            setSaveError(String(e));
        }
        setIsSaving(false);
    }, [path, editContent, onSaveSuccess, fetchDiagnostics]);

    const handleCancelEdit = () => {
        setEditContent(content || '');
        setIsEditing(false);
        setSaveError(null);
    };

    const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void handleSave();
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            const target = e.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const nextContent = `${editContent.slice(0, start)}  ${editContent.slice(end)}`;
            setEditContent(nextContent);
            requestAnimationFrame(() => {
                target.selectionStart = start + 2;
                target.selectionEnd = start + 2;
            });
        }
    };

    if (!path) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                    <Code className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Select a file to view</p>
                </div>
            </div>
        );
    }

    if (isLoading && content === null) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center text-red-400">
                <div className="text-center">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    const filename = path.split('/').pop() || path;
    const language = getPrismLanguage(extension);

    const lineDiagnostics = new Map<number, Diagnostic[]>();
    diagnostics.forEach((d) => {
        const existing = lineDiagnostics.get(d.line) || [];
        existing.push(d);
        lineDiagnostics.set(d.line, existing);
    });

    const errorCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = diagnostics.filter(d => d.severity === 'warning').length;
    const hasUnsavedChanges = isEditing && editContent !== (content || '');

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2">
                    {getFileIcon({ name: filename, path, type: 'file', extension })}
                    <span className="text-sm font-medium text-white">{filename}</span>
                    <Badge variant="default" className="text-xs">{language}</Badge>
                    {isEditing && <Badge variant="warning" className="text-xs">Editing</Badge>}
                    {hasUnsavedChanges && <Badge variant="error" className="text-xs">Unsaved</Badge>}
                    {diagnostics.length > 0 && (
                        <button
                            onClick={() => setShowDiagnostics(!showDiagnostics)}
                            className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors !outline-none",
                                showDiagnostics ? "bg-white/10" : "hover:bg-white/5"
                            )}
                        >
                            {errorCount > 0 && (
                                <span className="flex items-center gap-1 text-red-400">
                                    <AlertCircle className="w-3 h-3" /> {errorCount}
                                </span>
                            )}
                            {warningCount > 0 && (
                                <span className="flex items-center gap-1 text-yellow-400">
                                    <AlertTriangle className="w-3 h-3" /> {warningCount}
                                </span>
                            )}
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    {lastModified && <span>Updated: {lastModified}</span>}
                    {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}

                    {!isBinary && (
                        <>
                            {isEditing ? (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={isSaving || !hasUnsavedChanges}
                                        className="text-emerald-400 hover:text-emerald-300"
                                    >
                                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        <span className="ml-1">Save</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleCancelEdit}
                                        className="text-gray-400 hover:text-gray-300"
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsEditing(true)}
                                    className="text-gray-400 hover:text-white"
                                >
                                    <Edit3 className="w-4 h-4" />
                                    <span className="ml-1">Edit</span>
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {saveError && (
                <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm">
                    {saveError}
                </div>
            )}

            <div className="flex-1 overflow-auto">
                {isEditing ? (
                    <div className="flex h-full">
                        <div
                            className="flex-shrink-0 text-right pr-2 select-none text-gray-600 font-mono text-sm border-r border-white/5 bg-black/20"
                            style={{ paddingTop: '16px' }}
                        >
                            {editContent.split('\n').map((_, i) => (
                                <div key={i} className="h-[1.5em] px-2">{i + 1}</div>
                            ))}
                        </div>
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={handleEditorKeyDown}
                            className="flex-1 p-4 bg-transparent font-mono text-sm text-gray-300 resize-none !outline-none focus:!outline-none leading-[1.5em]"
                            spellCheck={false}
                            onScroll={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                const gutter = target.previousElementSibling as HTMLElement;
                                if (gutter) gutter.scrollTop = target.scrollTop;
                            }}
                        />
                    </div>
                ) : (
                    <Highlight theme={themes.nightOwl} code={content || ''} language={language}>
                        {({ className, style, tokens, getLineProps, getTokenProps }) => (
                            <pre className={cn(className, 'p-4 text-sm overflow-x-auto')} style={{ ...style, background: 'transparent' }}>
                                {tokens.map((line, i) => {
                                    const lineNum = i; // 0-indexed from LSP
                                    const lineDiags = lineDiagnostics.get(lineNum) || [];
                                    const hasError = lineDiags.some(d => d.severity === 'error');
                                    const hasWarning = lineDiags.some(d => d.severity === 'warning');

                                    return (
                                        <div
                                            key={i}
                                            {...getLineProps({ line })}
                                            className={cn(
                                                "table-row group",
                                                hasError && "bg-red-500/10",
                                                hasWarning && !hasError && "bg-yellow-500/10"
                                            )}
                                        >
                                            <span className={cn(
                                                "table-cell pr-2 select-none text-right w-8 border-r border-white/5 mr-2",
                                                hasError ? "text-red-400" : hasWarning ? "text-yellow-400" : "text-gray-600"
                                            )}>
                                                {lineDiags.length > 0 ? (
                                                    <span className="inline-flex items-center justify-end w-full" title={lineDiags.map(d => d.message).join('\n')}>
                                                        {hasError ? <AlertCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                                    </span>
                                                ) : (
                                                    i + 1
                                                )}
                                            </span>
                                            <span className="table-cell pl-2">
                                                {line.map((token, key) => (
                                                    <span key={key} {...getTokenProps({ token })} />
                                                ))}
                                            </span>
                                        </div>
                                    );
                                })}
                            </pre>
                        )}
                    </Highlight>
                )}
            </div>

            {showDiagnostics && diagnostics.length > 0 && (
                <div className="max-h-48 overflow-y-auto border-t border-white/10 bg-black/30">
                    <div className="px-3 py-2 text-xs font-medium text-gray-400 border-b border-white/5 flex items-center gap-2">
                        <Zap className="w-3 h-3" />
                        Problems ({diagnostics.length})
                    </div>
                    <div className="divide-y divide-white/5">
                        {diagnostics.map((diag, i) => (
                            <div key={i} className="px-3 py-2 text-sm flex items-start gap-2 hover:bg-white/5">
                                {getSeverityIcon(diag.severity)}
                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-300 break-words">{diag.message}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        Line {diag.line + 1}, Col {diag.character + 1}
                                        {diag.source && <span className="ml-2">[{diag.source}]</span>}
                                        {diag.code && <span className="ml-1">({diag.code})</span>}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function CreateDialog({
    isOpen,
    type,
    parentPath,
    onClose,
    onSuccess,
}: {
    isOpen: boolean;
    type: 'file' | 'directory';
    parentPath: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [name, setName] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCreate = async () => {
        if (!name.trim()) return;

        setIsCreating(true);
        setError(null);
        try {
            const res = await apiFetch('/api/ide/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentPath, name: name.trim(), type }),
            });
            const data = await res.json();
            if (data.success) {
                setName('');
                onSuccess();
                onClose();
            } else {
                setError(data.error || 'Failed to create');
            }
        } catch (e) {
            setError(String(e));
        }
        setIsCreating(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="glass-card rounded-xl p-6 w-96">
                <h3 className="text-lg font-semibold text-white mb-4">
                    New {type === 'file' ? 'File' : 'Folder'}
                </h3>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={type === 'file' ? 'filename.ts' : 'folder-name'}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm mb-4 !outline-none focus:border-indigo-500/50"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
                {error && (
                    <p className="text-red-400 text-sm mb-4">{error}</p>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" onClick={handleCreate} disabled={isCreating || !name.trim()}>
                        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        <span className="ml-1">Create</span>
                    </Button>
                </div>
            </div>
        </div>
    );
}

function LSPStatus() {
    const [languages, setLanguages] = useState<LSPLanguage[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await apiFetch('/api/lsp/languages');
                const data = await res.json();
                setLanguages(data.languages || []);
            } catch {
                // Ignore errors
            }
            setIsLoading(false);
        };
        fetchStatus();
    }, []);

    if (isLoading) return null;

    const available = languages.filter(l => l.available);

    return (
        <div className="px-3 py-2 border-t border-white/10 bg-white/5">
            <div className="flex items-center gap-2 text-xs text-gray-500">
                <Zap className="w-3 h-3" />
                <span>LSP:</span>
                {available.length > 0 ? (
                    <span className="text-emerald-400">
                        {available.map(l => l.name).join(', ')}
                    </span>
                ) : (
                    <span className="text-gray-600">None active</span>
                )}
            </div>
        </div>
    );
}

function GitStatus({ path }: { path: string }) {
    const [branch, setBranch] = useState<string | null>(null);
    const [modified, setModified] = useState(0);
    const [untracked, setUntracked] = useState(0);

    useEffect(() => {
        const fetchGit = async () => {
            try {
                const res = await apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`);
                const data = await res.json();
                if (data.isRepo) {
                    setBranch(data.branch || 'HEAD');
                    setModified(data.modified?.length || 0);
                    setUntracked(data.untracked?.length || 0);
                } else {
                    setBranch(null);
                }
            } catch {
                setBranch(null);
            }
        };
        fetchGit();
    }, [path]);

    if (!branch) return null;

    return (
        <div className="px-3 py-2 border-t border-white/10 bg-white/5">
            <div className="flex items-center gap-2 text-xs text-gray-500">
                <GitBranch className="w-3 h-3" />
                <span className="text-indigo-400 font-medium">{branch}</span>
                {modified > 0 && (
                    <span className="text-yellow-400">~{modified}</span>
                )}
                {untracked > 0 && (
                    <span className="text-gray-400">+{untracked}</span>
                )}
            </div>
        </div>
    );
}

export function IDE() {
    const [currentPath, setCurrentPath] = useState<string>('~');
    const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [rootInfo, setRootInfo] = useState<BrowseResult | null>(null);
    const [createType, setCreateType] = useState<'file' | 'directory' | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        const fetchRoot = async () => {
            const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(currentPath)}`);
            const data: BrowseResult = await res.json();
            if (data.success) {
                setRootInfo(data);
            }
        };
        fetchRoot();
    }, [currentPath, refreshKey]);

    const handleToggleDir = (path: string) => {
        setExpandedDirs((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const handleSelectFile = (entry: FileEntry) => {
        if (entry.type === 'file') {
            setSelectedFile(entry);
        }
    };

    const handleGoHome = () => {
        setCurrentPath('~');
        setSelectedFile(null);
        setExpandedDirs(new Set());
    };

    const handleGoUp = () => {
        if (rootInfo?.parent) {
            setCurrentPath(rootInfo.parent);
            setSelectedFile(null);
            setExpandedDirs(new Set());
        }
    };

    const handleRefresh = () => {
        setRefreshKey((k) => k + 1);
    };

    return (
        <div className="h-screen flex flex-col bg-[#050508]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-400 font-medium">IDE</span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={cn('px-2 py-1 h-7', autoRefresh && 'text-emerald-400')}
                    >
                        {autoRefresh ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        <span className="ml-1 text-xs">{autoRefresh ? 'Live' : 'Static'}</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleRefresh} className="px-2 py-1 h-7">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-64 border-r border-white/10 flex flex-col overflow-hidden bg-white/[0.01]">
                    <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 bg-white/5">
                        <Button variant="ghost" size="sm" onClick={handleGoHome} className="p-1 h-6 w-6">
                            <Home className="w-3.5 h-3.5" />
                        </Button>
                        {rootInfo?.parent && (
                            <Button variant="ghost" size="sm" onClick={handleGoUp} className="p-1">
                                <ChevronRight className="w-4 h-4 rotate-180" />
                            </Button>
                        )}
                        <span className="text-xs text-gray-400 truncate flex-1" title={rootInfo?.path}>
                            {rootInfo?.path?.replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/, '~') || currentPath}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setCreateType('file')} className="p-1" title="New File">
                            <FilePlus className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setCreateType('directory')} className="p-1" title="New Folder">
                            <FolderPlus className="w-4 h-4" />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto py-2" key={refreshKey}>
                        <FileTree
                            path={rootInfo?.path || currentPath}
                            selectedPath={selectedFile?.path || null}
                            onSelectFile={handleSelectFile}
                            expandedDirs={expandedDirs}
                            onToggleDir={handleToggleDir}
                        />
                    </div>

                    <LSPStatus />
                    <GitStatus path={rootInfo?.path || currentPath} />
                </div>

                <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0d12]">
                    <CodeViewer
                        path={selectedFile?.path || null}
                        autoRefresh={autoRefresh}
                        onSaveSuccess={handleRefresh}
                    />
                </div>
            </div>

            <CreateDialog
                isOpen={createType !== null}
                type={createType || 'file'}
                parentPath={rootInfo?.path || currentPath}
                onClose={() => setCreateType(null)}
                onSuccess={handleRefresh}
            />
        </div>
    );
}

export default IDE;
