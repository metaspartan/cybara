#!/usr/bin/env bun
/**
 * Cybara CLI - Ink-based TUI for the AI agent platform
 */

import React from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import Spinner from "ink-spinner";
import { spawn } from "child_process";

const API_BASE = process.env.CYBARA_API || "http://localhost:4269";

// Types
interface AppProps {
    command?: string;
    args?: string[];
}

interface StatusResponse {
    status: string;
    uptime: number;
    checks: Record<string, { status: string; total?: number; running?: number }>;
    timestamp: string;
}

interface MetricsResponse {
    totalTokens: number;
    totalRequests: number;
    avgLatency: number;
    providers: Record<string, { tokens: number; requests: number }>;
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

// Fetch helper
async function fetchAPI<T>(endpoint: string): Promise<T | null> {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch {
        return null;
    }
}

// ============================================
// Components
// ============================================

const Logo = ({ compact = false }: { compact?: boolean }) => (
    <Box flexDirection="column" alignItems="center" marginBottom={compact ? 0 : 1}>
        {!compact && (
            <Gradient name="rainbow">
                <BigText text="Cybara" font="chrome" />
            </Gradient>
        )}
        <Text color="gray">AI Agent Platform v1.0.0</Text>
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

// ============================================
// Command Components
// ============================================

// Status Command
const StatusCommand = () => {
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

// Metrics Command
const MetricsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<MetricsResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<MetricsResponse>("/api/metrics/summary")
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
                    <Text color="green">{(data.totalTokens || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Total Requests: </Text>
                    <Text>{(data.totalRequests || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Avg Latency:    </Text>
                    <Text>{(data.avgLatency || 0).toFixed(0)}ms</Text>
                </Box>
            </Box>
            {data.providers && Object.keys(data.providers).length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="cyan">By Provider</Text>
                    {Object.entries(data.providers).map(([name, info]) => (
                        <Box key={name}>
                            <Box width={20}><Text color="gray">{name}</Text></Box>
                            <Text>{info.tokens.toLocaleString()} tokens</Text>
                            <Text color="gray"> / {info.requests} requests</Text>
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

// Tasks Command
const TasksCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<TaskItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<{ tasks: TaskItem[] }>("/api/tasks")
            .then((d) => {
                if (d) setData(d.tasks || []);
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

// Skills Command
const SkillsCommand = () => {
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

// Agents Command
const AgentsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<AgentItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<{ agents: AgentItem[] }>("/api/agents")
            .then((d) => {
                if (d) setData(d.agents || []);
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

// Help Command
const HelpCommand = () => {
    const { exit } = useApp();

    useInput((input) => {
        if (input === "q") exit();
    });

    const commands = [
        { cmd: "cybara", desc: "Interactive TUI menu" },
        { cmd: "cybara start", desc: "Start the server" },
        { cmd: "cybara install", desc: "Run install wizard" },
        { cmd: "cybara status", desc: "Show system status" },
        { cmd: "cybara metrics", desc: "Show token usage metrics" },
        { cmd: "cybara tasks", desc: "List scheduled tasks" },
        { cmd: "cybara skills", desc: "List installed skills" },
        { cmd: "cybara agents", desc: "List configured agents" },
        { cmd: "cybara help", desc: "Show this help" },
    ];

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Available Commands</Text>
            </Box>
            {commands.map((c) => (
                <Box key={c.cmd}>
                    <Box width={25}><Text color="green">{c.cmd}</Text></Box>
                    <Text color="gray">{c.desc}</Text>
                </Box>
            ))}
            <Box marginTop={1}>
                <Text color="gray">Environment: CYBARA_API={API_BASE}</Text>
            </Box>
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
                // Re-render with the specific command
                render(<App command={action} />);
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
                <Text bold marginBottom={1}>Main Menu</Text>
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

// Install Command Component
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
                <Text bold marginBottom={1}>Installing Cybara</Text>
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

// App Router
const App = ({ command, args }: AppProps) => {
    switch (command) {
        case "install":
            return <InstallCommand />;
        case "start":
        case "dev":
            spawn("bun", ["run", "dev"], { stdio: "inherit" });
            return <Text color="cyan">Starting Cybara server...</Text>;
        case "status":
            return <StatusCommand />;
        case "metrics":
            return <MetricsCommand />;
        case "tasks":
            return <TasksCommand />;
        case "skills":
            return <SkillsCommand />;
        case "agents":
            return <AgentsCommand />;
        case "help":
        case "--help":
        case "-h":
            return <HelpCommand />;
        default:
            return <MainMenu />;
    }
};

// Parse CLI arguments
const args = process.argv.slice(2);
const command = args[0];

// Render the app
render(<App command={command} args={args.slice(1)} />);
