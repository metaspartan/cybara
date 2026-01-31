#!/usr/bin/env bun
/**
 * Cybara CLI - TUI for interactive use, raw output for commands
 * 
 * Usage:
 *   cybara              # Interactive TUI menu
 *   cybara status       # Raw text output
 *   cybara metrics      # Raw text output
 *   cybara agents       # Raw text output
 *   cybara skills       # Raw text output
 *   cybara tasks        # Raw text output
 *   cybara help         # Raw text help
 */

import React from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import Spinner from "ink-spinner";
import { spawn } from "child_process";

const API_BASE = process.env.CYBARA_API || "http://localhost:4269";

// ============================================
// Types
// ============================================

interface StatusResponse {
    status: string;
    uptime: number;
    checks: Record<string, { status: string; total?: number; running?: number }>;
    timestamp: string;
}

interface MetricsResponse {
    tokenUsage: { total: number; input: number; output: number; cache: number };
    fileOperations: { filesRead: number; filesWritten: number; filesEdited: number };
    toolCalls: { totalCalls: number };
    apiCalls: { totalCalls: number; successfulCalls: number; failedCalls: number };
    agentExecutions: { totalExecutions: number; totalMessages: number };
}

interface TaskItem {
    id: string;
    name: string;
    status: string;
    schedule?: string;
    lastRun?: string;
}

interface SkillItem {
    name: string;
    description: string;
    eligible: boolean;
    source: string;
}

interface AgentItem {
    id: string;
    name: string;
    type: string;
    status: string;
    model?: string;
}

// ============================================
// Fetch Helper
// ============================================

async function fetchAPI<T>(endpoint: string): Promise<T | null> {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json() as T;
    } catch {
        return null;
    }
}

// ============================================
// RAW OUTPUT MODE (for agents/scripts)
// ============================================

async function rawStatus(): Promise<void> {
    const data = await fetchAPI<StatusResponse>("/api/health");
    if (!data) {
        console.error("ERROR: Failed to connect to Cybara server at", API_BASE);
        process.exit(1);
    }

    const formatUptime = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    console.log("CYBARA STATUS");
    console.log("=============");
    console.log(`status: ${data.status}`);
    console.log(`uptime: ${formatUptime(data.uptime)}`);
    console.log(`timestamp: ${data.timestamp}`);
    console.log("");
    console.log("HEALTH CHECKS");
    for (const [name, info] of Object.entries(data.checks || {})) {
        const status = info.status || "ok";
        const extra = info.total !== undefined ? ` (${info.total} total)` : "";
        console.log(`  ${name}: ${status}${extra}`);
    }
}

async function rawMetrics(): Promise<void> {
    const data = await fetchAPI<MetricsResponse>("/api/metrics/overview");
    if (!data) {
        console.error("ERROR: Failed to fetch metrics from", API_BASE);
        process.exit(1);
    }

    console.log("CYBARA METRICS");
    console.log("==============");
    console.log("");
    console.log("TOKEN USAGE");
    console.log(`  total: ${data.tokenUsage?.total || 0}`);
    console.log(`  input: ${data.tokenUsage?.input || 0}`);
    console.log(`  output: ${data.tokenUsage?.output || 0}`);
    console.log(`  cache: ${data.tokenUsage?.cache || 0}`);
    console.log("");
    console.log("FILE OPERATIONS");
    console.log(`  files_read: ${data.fileOperations?.filesRead || 0}`);
    console.log(`  files_written: ${data.fileOperations?.filesWritten || 0}`);
    console.log(`  files_edited: ${data.fileOperations?.filesEdited || 0}`);
    console.log("");
    console.log("TOOL CALLS");
    console.log(`  total: ${data.toolCalls?.totalCalls || 0}`);
    console.log("");
    console.log("API CALLS");
    console.log(`  total: ${data.apiCalls?.totalCalls || 0}`);
    console.log(`  success: ${data.apiCalls?.successfulCalls || 0}`);
    console.log(`  failed: ${data.apiCalls?.failedCalls || 0}`);
}

async function rawAgents(): Promise<void> {
    const data = await fetchAPI<AgentItem[]>("/api/agents");
    if (!data) {
        console.error("ERROR: Failed to fetch agents from", API_BASE);
        process.exit(1);
    }

    const agents = Array.isArray(data) ? data : [];
    console.log("CYBARA AGENTS");
    console.log("=============");
    console.log(`total: ${agents.length}`);
    console.log("");

    if (agents.length === 0) {
        console.log("No agents configured");
        return;
    }

    for (const agent of agents) {
        console.log(`- ${agent.name}`);
        console.log(`  id: ${agent.id}`);
        console.log(`  type: ${agent.type}`);
        console.log(`  status: ${agent.status || "inactive"}`);
        if (agent.model) console.log(`  model: ${agent.model}`);
    }
}

async function rawTasks(): Promise<void> {
    const data = await fetchAPI<TaskItem[]>("/api/tasks");
    if (!data) {
        console.error("ERROR: Failed to fetch tasks from", API_BASE);
        process.exit(1);
    }

    const tasks = Array.isArray(data) ? data : [];
    console.log("CYBARA TASKS");
    console.log("============");
    console.log(`total: ${tasks.length}`);
    console.log("");

    if (tasks.length === 0) {
        console.log("No tasks scheduled");
        return;
    }

    for (const task of tasks) {
        console.log(`- ${task.name}`);
        console.log(`  id: ${task.id}`);
        console.log(`  status: ${task.status}`);
        if (task.schedule) console.log(`  schedule: ${task.schedule}`);
        if (task.lastRun) console.log(`  last_run: ${task.lastRun}`);
    }
}

async function rawSkills(): Promise<void> {
    const data = await fetchAPI<{ skills: SkillItem[] }>("/api/skills/status");
    if (!data) {
        console.error("ERROR: Failed to fetch skills from", API_BASE);
        process.exit(1);
    }

    const skills = data.skills || [];
    const eligible = skills.filter(s => s.eligible).length;

    console.log("CYBARA SKILLS");
    console.log("=============");
    console.log(`total: ${skills.length}`);
    console.log(`eligible: ${eligible}`);
    console.log(`blocked: ${skills.length - eligible}`);
    console.log("");

    if (skills.length === 0) {
        console.log("No skills installed");
        return;
    }

    console.log("ELIGIBLE:");
    for (const skill of skills.filter(s => s.eligible)) {
        console.log(`  - ${skill.name} (${skill.source})`);
    }

    console.log("");
    console.log("BLOCKED:");
    for (const skill of skills.filter(s => !s.eligible)) {
        console.log(`  - ${skill.name} (${skill.source})`);
    }
}

function rawHelp(): void {
    console.log("CYBARA CLI");
    console.log("==========");
    console.log("");
    console.log("Usage: cybara [command]");
    console.log("");
    console.log("Commands:");
    console.log("  (none)      Interactive TUI menu");
    console.log("  status      Show system status");
    console.log("  metrics     Show token usage and metrics");
    console.log("  agents      List configured agents");
    console.log("  tasks       List scheduled tasks");
    console.log("  skills      List installed skills");
    console.log("  start       Start the server");
    console.log("  install     Run installation wizard (TUI)");
    console.log("  help        Show this help");
    console.log("");
    console.log(`Environment: CYBARA_API=${API_BASE}`);
}

// ============================================
// TUI COMPONENTS (for interactive use)
// ============================================

const Logo = ({ compact = false }: { compact?: boolean }) => (
    <Box flexDirection="column" alignItems="center" marginBottom={compact ? 0 : 1}>
        {!compact && (
            <Gradient name="rainbow">
                <BigText text="Cybara" font="chrome" />
            </Gradient>
        )}
        <Text color="gray">Cybara TUI</Text>
    </Box>
);

const Table = ({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) => (
    <Box flexDirection="column">
        <Box>
            {headers.map((h, i) => (
                <Box key={i} width={i === 0 ? 20 : 15} marginRight={1}>
                    <Text bold color="cyan">{h}</Text>
                </Box>
            ))}
        </Box>
        <Box marginBottom={1}>
            <Text color="gray">{"─".repeat(60)}</Text>
        </Box>
        {rows.map((row, i) => (
            <Box key={i}>
                {row.map((cell, j) => (
                    <Box key={j} width={j === 0 ? 20 : 15} marginRight={1}>
                        {typeof cell === "string" ? <Text>{cell}</Text> : cell}
                    </Box>
                ))}
            </Box>
        ))}
    </Box>
);

const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
        healthy: "green",
        running: "green",
        active: "green",
        eligible: "green",
        stopped: "yellow",
        error: "red",
        blocked: "red",
    };
    return <Text color={colors[status] || "white"}>{status}</Text>;
};

const LoadingState = ({ message }: { message: string }) => (
    <Box>
        <Text color="yellow">
            <Spinner type="dots" /> {message}
        </Text>
    </Box>
);

const ErrorState = ({ message }: { message: string }) => (
    <Box>
        <Text color="red">✗ {message}</Text>
    </Box>
);

// TUI Status Command
const TUIStatusCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<StatusResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<StatusResponse>("/api/health")
            .then((d) => {
                if (d) setData(d);
                else setError("Failed to connect to Cybara server");
            })
            .finally(() => setLoading(false));
    }, []);

    const formatUptime = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    if (loading) return <LoadingState message="Fetching status..." />;
    if (error) return <ErrorState message={error} />;
    if (!data) return <ErrorState message="No data" />;

    const checks = Object.entries(data.checks || {});

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>System Status</Text>
                <Box marginTop={1}>
                    <Text color="gray">Status:  </Text>
                    <StatusBadge status={data.status} />
                </Box>
                <Box>
                    <Text color="gray">Uptime:  </Text>
                    <Text>{formatUptime(data.uptime)}</Text>
                </Box>
                <Box>
                    <Text color="gray">Time:    </Text>
                    <Text>{new Date(data.timestamp).toLocaleString()}</Text>
                </Box>
            </Box>
            {checks.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="cyan">Health Checks</Text>
                    {checks.map(([name, info]) => (
                        <Box key={name}>
                            <Box width={15}><Text color="gray">{name}</Text></Box>
                            <StatusBadge status={info.status} />
                            {info.total !== undefined && <Text color="gray"> ({info.total} total)</Text>}
                        </Box>
                    ))}
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};

// TUI Metrics Command
const TUIMetricsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<MetricsResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<MetricsResponse>("/api/metrics/overview")
            .then((d) => {
                if (d) setData(d);
                else setError("Failed to fetch metrics");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching metrics..." />;
    if (error) return <ErrorState message={error} />;
    if (!data) return <ErrorState message="No data" />;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>Token Metrics</Text>
                <Box marginTop={1}>
                    <Text color="gray">Total Tokens:   </Text>
                    <Text color="green">{(data.tokenUsage?.total || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Input Tokens:   </Text>
                    <Text>{(data.tokenUsage?.input || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Output Tokens:  </Text>
                    <Text>{(data.tokenUsage?.output || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Tool Calls:     </Text>
                    <Text>{(data.toolCalls?.totalCalls || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">API Calls:      </Text>
                    <Text>{(data.apiCalls?.totalCalls || 0).toLocaleString()}</Text>
                </Box>
            </Box>
            {data.fileOperations && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="cyan">File Operations</Text>
                    <Box>
                        <Box width={20}><Text color="gray">Files Read</Text></Box>
                        <Text>{(data.fileOperations.filesRead || 0).toLocaleString()}</Text>
                    </Box>
                    <Box>
                        <Box width={20}><Text color="gray">Files Written</Text></Box>
                        <Text>{(data.fileOperations.filesWritten || 0).toLocaleString()}</Text>
                    </Box>
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};

// TUI Skills Command
const TUISkillsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<SkillItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<{ skills: SkillItem[] }>("/api/skills/status")
            .then((d) => {
                if (d) setData(d.skills || []);
                else setError("Failed to fetch skills");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching skills..." />;
    if (error) return <ErrorState message={error} />;

    const eligible = data.filter((s) => s.eligible).length;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Skills ({eligible}/{data.length} eligible)</Text>
            </Box>
            {data.length === 0 ? (
                <Text color="gray">No skills installed</Text>
            ) : (
                <Table
                    headers={["Name", "Status", "Source"]}
                    rows={data.map((s) => [
                        s.name,
                        <StatusBadge key={s.name} status={s.eligible ? "eligible" : "blocked"} />,
                        s.source,
                    ])}
                />
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};

// TUI Agents Command
const TUIAgentsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<AgentItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<AgentItem[]>("/api/agents")
            .then((d) => {
                if (d) setData(Array.isArray(d) ? d : []);
                else setError("Failed to fetch agents");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching agents..." />;
    if (error) return <ErrorState message={error} />;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Agents ({data.length})</Text>
            </Box>
            {data.length === 0 ? (
                <Text color="gray">No agents configured</Text>
            ) : (
                <Table
                    headers={["Name", "Type", "Status", "Model"]}
                    rows={data.map((a) => [
                        a.name,
                        a.type,
                        <StatusBadge key={a.id} status={a.status} />,
                        a.model || "-",
                    ])}
                />
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};

// TUI Tasks Command
const TUITasksCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<TaskItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<TaskItem[]>("/api/tasks")
            .then((d) => {
                if (d) setData(Array.isArray(d) ? d : []);
                else setError("Failed to fetch tasks");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching tasks..." />;
    if (error) return <ErrorState message={error} />;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Scheduled Tasks ({data.length})</Text>
            </Box>
            {data.length === 0 ? (
                <Text color="gray">No tasks scheduled</Text>
            ) : (
                <Table
                    headers={["Name", "Status", "Schedule"]}
                    rows={data.map((t) => [
                        t.name,
                        <StatusBadge key={t.id} status={t.status} />,
                        t.schedule || "-",
                    ])}
                />
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};

// Main Menu Component
const MainMenu = () => {
    const { exit } = useApp();
    const [selected, setSelected] = React.useState(0);
    const [status, setStatus] = React.useState<{ message: string; type: "info" | "success" | "error" | "loading" } | null>(null);

    const menuItems = [
        { label: "Start Server", action: "start" },
        { label: "View Status", action: "status" },
        { label: "View Metrics", action: "metrics" },
        { label: "View Skills", action: "skills" },
        { label: "View Agents", action: "agents" },
        { label: "View Tasks", action: "tasks" },
        { label: "Open Web UI", action: "ui" },
        { label: "Exit", action: "exit" },
    ];

    useInput((input, key) => {
        if (key.upArrow) {
            setSelected((s) => (s > 0 ? s - 1 : menuItems.length - 1));
        } else if (key.downArrow) {
            setSelected((s) => (s < menuItems.length - 1 ? s + 1 : 0));
        } else if (key.return) {
            handleAction(menuItems[selected].action);
        } else if (input === "q") {
            exit();
        }
    });

    const handleAction = async (action: string) => {
        switch (action) {
            case "start":
                setStatus({ message: "Starting Cybara server...", type: "loading" });
                spawn("bun", ["run", "dev"], { stdio: "inherit" });
                break;
            case "status":
            case "metrics":
            case "skills":
            case "agents":
            case "tasks":
                // Re-render with the specific TUI command
                render(<TUIApp command={action} />);
                break;
            case "ui":
                setStatus({ message: "Opening browser...", type: "info" });
                spawn("open", [`${API_BASE}`]);
                break;
            case "exit":
                exit();
                break;
        }
    };

    return (
        <Box flexDirection="column">
            <Logo />
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>Main Menu</Text>
                {menuItems.map((item, i) => (
                    <Text key={item.action} color={i === selected ? "cyan" : "white"}>
                        {i === selected ? "❯ " : "  "}{item.label}
                    </Text>
                ))}
            </Box>
            {status && (
                <Box marginY={1}>
                    {status.type === "loading" ? (
                        <Text color="yellow"><Spinner type="dots" /> {status.message}</Text>
                    ) : (
                        <Text color={status.type === "success" ? "green" : status.type === "error" ? "red" : "cyan"}>
                            {status.type === "success" ? "✓" : status.type === "error" ? "✗" : "→"} {status.message}
                        </Text>
                    )}
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="gray">↑/↓ Navigate • Enter Select • q Quit</Text>
            </Box>
        </Box>
    );
};

// Install Command Component (always TUI)
const InstallCommand = () => {
    const { exit } = useApp();
    const [step, setStep] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);

    const steps = [
        { label: "Checking environment...", check: () => true },
        { label: "Installing dependencies...", action: () => spawn("bun", ["install"]) },
        { label: "Installing Playwright browsers...", action: () => spawn("bunx", ["playwright", "install"]) },
        { label: "Building UI...", action: () => spawn("bun", ["run", "ui:build"]) },
        { label: "Building server...", action: () => spawn("bun", ["run", "build"]) },
    ];

    React.useEffect(() => {
        const runStep = async () => {
            if (step >= steps.length) {
                setTimeout(() => exit(), 2000);
                return;
            }

            const currentStep = steps[step];
            if (currentStep.action) {
                const proc = currentStep.action();
                proc.on("close", (code: number) => {
                    if (code === 0) {
                        setStep((s) => s + 1);
                    } else {
                        setError(`Failed at step: ${currentStep.label}`);
                    }
                });
                proc.on("error", (err: Error) => setError(err.message));
            } else {
                setStep((s) => s + 1);
            }
        };

        if (!error) {
            runStep();
        }
    }, [step, error]);

    return (
        <Box flexDirection="column">
            <Logo />
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>Installing Cybara</Text>
                {steps.map((s, i) => (
                    <Box key={i}>
                        {i < step ? (
                            <Text color="green">✓ {s.label}</Text>
                        ) : i === step && !error ? (
                            <Text color="yellow"><Spinner type="dots" /> {s.label}</Text>
                        ) : error && i === step ? (
                            <Text color="red">✗ {s.label}</Text>
                        ) : (
                            <Text color="gray">○ {s.label}</Text>
                        )}
                    </Box>
                ))}
            </Box>
            {error && (
                <Box marginTop={1}>
                    <Text color="red">Error: {error}</Text>
                </Box>
            )}
            {step >= steps.length && (
                <Box marginTop={1}>
                    <Text color="green" bold>✓ Installation complete! Run `cybara start` to begin.</Text>
                </Box>
            )}
        </Box>
    );
};

// TUI App Router (for interactive mode)
const TUIApp = ({ command }: { command?: string }) => {
    switch (command) {
        case "install":
            return <InstallCommand />;
        case "status":
            return <TUIStatusCommand />;
        case "metrics":
            return <TUIMetricsCommand />;
        case "tasks":
            return <TUITasksCommand />;
        case "skills":
            return <TUISkillsCommand />;
        case "agents":
            return <TUIAgentsCommand />;
        default:
            return <MainMenu />;
    }
};

// ============================================
// MAIN ENTRY POINT
// ============================================

const args = process.argv.slice(2);
const command = args[0];

// Route to raw output or TUI based on command
async function main() {
    switch (command) {
        // Raw output commands (for agents/scripts)
        case "status":
            await rawStatus();
            break;
        case "metrics":
            await rawMetrics();
            break;
        case "agents":
            await rawAgents();
            break;
        case "tasks":
            await rawTasks();
            break;
        case "skills":
            await rawSkills();
            break;
        case "help":
        case "--help":
        case "-h":
            rawHelp();
            break;

        // Server start (pass-through)
        case "start":
        case "dev":
            spawn("bun", ["run", "dev"], { stdio: "inherit" });
            break;

        // TUI commands (interactive)
        case "install":
        case "tui":
            render(<TUIApp command={command === "tui" ? undefined : command} />);
            break;

        // Default: show TUI menu
        default:
            render(<TUIApp />);
            break;
    }
}

main();
