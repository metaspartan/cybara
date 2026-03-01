export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LocationLink {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
  originSelectionRange?: Range;
}

export type DefinitionResult = Location | Location[] | LocationLink[] | null;
export type DocumentSymbolResult = DocumentSymbol[] | SymbolInformation[] | null;

export interface SymbolInformation {
  name: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  location: Location;
  containerName?: string;
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface DiagnosticSeverity {
  Error: 1;
  Warning: 2;
  Information: 3;
  Hint: 4;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

export interface InitializeParams {
  processId: number | null;
  capabilities: ClientCapabilities;
  rootUri: string | null;
  workspaceFolders?: WorkspaceFolder[] | null;
}

export interface WorkspaceFolder {
  uri: string;
  name: string;
}

export interface ClientCapabilities {
  workspace?: {
    workspaceFolders?: boolean;
    didChangeConfiguration?: { dynamicRegistration?: boolean };
  };
  textDocument?: {
    synchronization?: {
      dynamicRegistration?: boolean;
      willSave?: boolean;
      didSave?: boolean;
      willSaveWaitUntil?: boolean;
    };
    completion?: {
      dynamicRegistration?: boolean;
      completionItem?: {
        snippetSupport?: boolean;
        commitCharactersSupport?: boolean;
        documentationFormat?: string[];
      };
    };
    hover?: { dynamicRegistration?: boolean; contentFormat?: string[] };
    signatureHelp?: { dynamicRegistration?: boolean };
    definition?: { dynamicRegistration?: boolean };
    declaration?: { dynamicRegistration?: boolean };
    typeDefinition?: { dynamicRegistration?: boolean };
    implementation?: { dynamicRegistration?: boolean };
    references?: { dynamicRegistration?: boolean };
    documentHighlight?: { dynamicRegistration?: boolean };
    documentSymbol?: { dynamicRegistration?: boolean };
    publishDiagnostics?: { relatedInformation?: boolean };
  };
}

export interface InitializeResult {
  capabilities: ServerCapabilities;
  serverInfo?: { name: string; version?: string };
}

export interface ServerCapabilities {
  textDocumentSync?: number | TextDocumentSyncOptions;
  completionProvider?: {
    triggerCharacters?: string[];
    resolveProvider?: boolean;
  };
  hoverProvider?: boolean;
  definitionProvider?: boolean;
  declarationProvider?: boolean;
  typeDefinitionProvider?: boolean;
  implementationProvider?: boolean;
  referencesProvider?: boolean;
  documentSymbolProvider?: boolean;
  diagnosticProvider?: {
    identifier?: string;
    interFileDependencies?: boolean;
    workspaceDiagnostics?: boolean;
  };
}

export interface TextDocumentSyncOptions {
  openClose?: boolean;
  change?: number; // 0 = None, 1 = Full, 2 = Incremental
  willSave?: boolean;
  willSaveWaitUntil?: boolean;
  save?: boolean | { includeText?: boolean };
}

export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem;
}

export interface DidChangeTextDocumentParams {
  textDocument: VersionedTextDocumentIdentifier;
  contentChanges: TextDocumentContentChangeEvent[];
}

export interface TextDocumentContentChangeEvent {
  range?: Range;
  rangeLength?: number;
  text: string;
}

export interface DidSaveTextDocumentParams {
  textDocument: TextDocumentIdentifier;
  text?: string;
}

export interface DidCloseTextDocumentParams {
  textDocument: TextDocumentIdentifier;
}

export interface CompletionList {
  isIncomplete?: boolean;
  items: CompletionItem[];
}

export type CompletionResult = CompletionItem[] | CompletionList | null;

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?: TextEdit;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface Hover {
  contents:
    | string
    | { kind: string; value: string }
    | Array<string | { language: string; value: string }>;
  range?: Range;
}

export interface ReferenceParams extends TextDocumentPositionParams {
  context: { includeDeclaration: boolean };
}

export const LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".lua": "lua",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "scss",
  ".sql": "sql",
};

export function getLanguageId(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return LANGUAGE_IDS[ext] || "plaintext";
}
