import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Bot,
  Clock,
  Plus,
  Play,
  Square,
  Trash2,
  Edit2,
  Zap,
  Search,
  Calendar,
  Repeat,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Select, Textarea } from "../components/ui/Input";
import {
  useTasks,
  useAgentSummaries,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useStartTask,
  useStopTask,
  useTriggerTask,
} from "../hooks/useApi";
import { useUIStore } from "../stores/uiStore";
import { PageLayout } from "@/components/layout";
import type { Task, AgentSummary } from "../types";
import { useTaskNotifications } from "../hooks/useNotifications";
import { useSessions } from "../hooks/useChat";
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { buildSessionChatPath } from "./chat/chatRoute";
import { taskMatchesScope } from "./taskScope";

interface TaskRun {
  id: string;
  task_id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  session_id?: string;
  result_preview?: string;
  error?: string;
}

const schedulePresets = [
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 0 * * *", label: "Daily at midnight" },
  { value: "0 9 * * 1", label: "Weekly (Monday 9am)" },
  { value: "custom", label: "Custom (Cron)" },
];

export function Tasks() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAgentId = searchParams.get("agent")?.trim() || "";
  const initialSessionId = searchParams.get("session")?.trim() || "";
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(searchParams.get("new") === "1");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const { permission, requestPermission } = useTaskNotifications();

  const { data: tasks, isLoading } = useTasks();
  const { data: agents } = useAgentSummaries();
  const { data: sessions = [] } = useSessions({ limit: 200 });
  const { addToast } = useUIStore();
  const scopeAgent = agents?.find((agent) => agent.id === initialAgentId);
  const botScope = scopeAgent?.is_bot === true;
  const scopeSessionId = initialSessionId;

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const startTask = useStartTask();
  const stopTask = useStopTask();
  const triggerTask = useTriggerTask();

  const { data: taskRuns, isLoading: runsLoading } = useQuery<TaskRun[]>({
    queryKey: ["taskRuns", expandedTaskId],
    queryFn: async () => {
      if (!expandedTaskId) return [];
      const result = await tasksApi.getRuns(expandedTaskId);
      if (!result.success || !result.data) return [];
      return result.data;
    },
    enabled: !!expandedTaskId,
    refetchInterval: 5000, // Auto-refresh every 5 seconds when expanded
  });

  const scopedTasks = tasks?.filter((task) =>
    taskMatchesScope(task, initialAgentId, scopeSessionId)
  );
  const filteredTasks = scopedTasks?.filter((task) => {
    const normalizedSearch = searchQuery.toLowerCase();
    return (
      task.name.toLowerCase().includes(normalizedSearch) ||
      (task.action || "").toLowerCase().includes(normalizedSearch)
    );
  });
  const scopeTaskCount = scopedTasks?.length ?? 0;
  const activeScopeTaskCount = scopedTasks?.filter((task) => task.enabled).length ?? 0;

  const clearNewTaskParam = (): void => {
    if (searchParams.get("new") !== "1") return;
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  };

  const closeTaskModal = (): void => {
    setIsCreateModalOpen(false);
    setEditingTask(null);
    clearNewTaskParam();
  };

  const handleSave = async (formData: FormData) => {
    try {
      let schedule = formData.get("schedule_preset") as string;
      if (schedule === "custom") {
        schedule = formData.get("schedule_custom") as string;
      }

      const sessionId = String(formData.get("session_id") || "").trim();
      const payload: Partial<Task> = {
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        schedule,
        agent_id: String(formData.get("agent_id") || "").trim() || undefined,
        session_id: sessionId || null,
        action: formData.get("action") as string,
        enabled: editingTask?.enabled ?? true,
      };
      if (editingTask) {
        await updateTask.mutateAsync({ id: editingTask.id, data: payload });
      } else {
        await createTask.mutateAsync(payload);
      }
      addToast("success", editingTask ? "Task updated successfully" : "Task created successfully");
      closeTaskModal();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create task");
    }
  };

  const handleDelete = async () => {
    if (!deletingTask) return;
    try {
      await deleteTask.mutateAsync(deletingTask.id);
      addToast("success", "Task deleted successfully");
      setDeletingTask(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete task");
    }
  };

  const handleToggle = async (task: Task) => {
    try {
      if (task.enabled) {
        await stopTask.mutateAsync(task.id);
        addToast("success", "Task stopped");
      } else {
        await startTask.mutateAsync(task.id);
        addToast("success", "Task started");
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to toggle task");
    }
  };

  const handleTrigger = async (task: Task) => {
    try {
      await triggerTask.mutateAsync(task.id);
      addToast("success", "Task triggered manually");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to trigger task");
    }
  };

  const formatSchedule = (schedule: string) => {
    const preset = schedulePresets.find((p) => p.value === schedule);
    return preset?.label || schedule;
  };

  const formatLastRun = (date: string | undefined) => {
    if (!date) return "Never";
    return new Date(date).toLocaleString();
  };

  return (
    <PageLayout
      title={botScope && scopeAgent ? `${scopeAgent.name} routines` : "Tasks"}
      subtitle={
        botScope ? "Scheduled work and recent runs for this bot" : "Schedule automated agent tasks"
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {botScope && scopeSessionId ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate(buildSessionChatPath(scopeSessionId))}
            >
              Back to bot
            </Button>
          ) : null}
          <Button
            variant={permission === "granted" ? "secondary" : "ghost"}
            size="sm"
            leftIcon={
              permission === "granted" ? (
                <Bell className="w-4 h-4" />
              ) : (
                <BellOff className="w-4 h-4" />
              )
            }
            onClick={requestPermission}
            title={permission === "granted" ? "Notifications enabled" : "Enable notifications"}
          >
            {permission === "granted" ? "Notifications On" : "Enable Notifications"}
          </Button>
          <Button
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => {
              setEditingTask(null);
              setIsCreateModalOpen(true);
            }}
          >
            {botScope ? "Create Routine" : "Create Task"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {botScope && scopeAgent ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(var(--accent-primary),0.24)] bg-[rgba(var(--accent-primary),0.08)] p-4 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(var(--accent-primary),0.16)] text-[rgb(var(--accent-primary))]">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {scopeAgent.name}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {activeScopeTaskCount} active · {scopeTaskCount} total
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchParams({}, { replace: true })}
            >
              View all tasks
            </Button>
          </div>
        ) : null}
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="h-32 animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-white/10 rounded w-1/4 mb-4" />
                  <div className="h-3 bg-white/10 rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredTasks?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Clock className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="mb-2 text-lg font-medium text-[var(--text-primary)]">
                {botScope ? "No routines yet" : "No tasks found"}
              </h3>
              <p className="mb-4 text-[var(--text-muted)]">
                {botScope
                  ? `Give ${scopeAgent?.name ?? "this bot"} recurring or scheduled work.`
                  : "Create your first scheduled task"}
              </p>
              <Button onClick={() => setIsCreateModalOpen(true)}>
                {botScope ? "Create Routine" : "Create Task"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredTasks?.map((task) => (
              <Card key={task.id} hover>
                <CardContent className="p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="w-12 h-12 flex-shrink-0 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                        <Clock className="w-6 h-6 text-white" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="min-w-0 break-words font-medium text-white">
                            {task.name}
                          </h3>
                          <Badge variant={task.enabled ? "success" : "default"} size="sm">
                            {task.enabled ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        {task.description && (
                          <p className="text-sm text-gray-400 mt-1">{task.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm">
                          <div className="flex min-w-0 items-center gap-1.5 text-gray-400">
                            <Repeat className="w-4 h-4" />
                            <span className="min-w-0 break-words">
                              {formatSchedule(task.schedule)}
                            </span>
                          </div>
                          {task.session_id && (
                            <div className="flex min-w-0 items-center gap-1.5 text-gray-400">
                              <MessageSquare className="w-4 h-4" />
                              <span className="min-w-0 truncate">
                                {sessions.find((session) => session.id === task.session_id)
                                  ?.title || `Chat ${task.session_id.slice(0, 8)}`}
                              </span>
                            </div>
                          )}
                          <div className="flex min-w-0 items-center gap-1.5 text-gray-400">
                            <Calendar className="w-4 h-4" />
                            <span className="min-w-0 break-words">
                              Last run: {formatLastRun(task.last_run)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="task-action-grid grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center lg:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Edit2 className="w-4 h-4" />}
                        onClick={() => {
                          setEditingTask(task);
                          setIsCreateModalOpen(true);
                        }}
                        className="w-full lg:w-auto"
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Zap className="w-4 h-4" />}
                        onClick={() => handleTrigger(task)}
                        isLoading={triggerTask.isPending}
                        className="w-full lg:w-auto"
                      >
                        Run Now
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={
                          task.enabled ? (
                            <Square className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )
                        }
                        onClick={() => handleToggle(task)}
                        className="w-full lg:w-auto"
                      >
                        {task.enabled ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={
                          expandedTaskId === task.id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )
                        }
                        onClick={() =>
                          setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                        }
                        className="w-full lg:w-auto"
                      >
                        History
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setDeletingTask(task)}
                        className="w-full lg:w-auto"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  {expandedTaskId === task.id && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <h4 className="text-sm font-medium text-gray-300 mb-3">Recent Runs</h4>
                      {runsLoading ? (
                        <div className="flex items-center gap-2 text-gray-400 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading history...
                        </div>
                      ) : taskRuns && taskRuns.length > 0 ? (
                        <div className="space-y-2">
                          {taskRuns.map((run) => (
                            <div
                              key={run.id}
                              className="flex items-start gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/8 transition-colors"
                            >
                              {run.status === "completed" ? (
                                <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                              ) : run.status === "failed" ? (
                                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                              ) : (
                                <Loader2 className="w-5 h-5 text-amber-400 animate-spin flex-shrink-0 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge
                                    variant={
                                      run.status === "completed"
                                        ? "success"
                                        : run.status === "failed"
                                          ? "error"
                                          : "default"
                                    }
                                    size="sm"
                                  >
                                    {run.status}
                                  </Badge>
                                  <span className="text-xs text-gray-400">
                                    {new Date(run.started_at).toLocaleString()}
                                  </span>
                                  {run.completed_at && (
                                    <span className="text-xs text-gray-500">
                                      (
                                      {Math.round(
                                        (new Date(run.completed_at).getTime() -
                                          new Date(run.started_at).getTime()) /
                                          1000
                                      )}
                                      s)
                                    </span>
                                  )}
                                </div>
                                {run.result_preview && (
                                  <p className="text-sm text-gray-300 line-clamp-2">
                                    {run.result_preview}
                                  </p>
                                )}
                                {run.error && (
                                  <p className="text-sm text-red-400 line-clamp-2">{run.error}</p>
                                )}
                                {run.session_id && run.status === "completed" && (
                                  <a
                                    href={`/chat?session=${run.session_id}`}
                                    className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 transition-colors"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                    View Full Agent Response
                                  </a>
                                )}
                                {run.session_id && run.status === "running" && (
                                  <a
                                    href={`/chat?session=${run.session_id}`}
                                    className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 hover:text-amber-300 transition-colors"
                                  >
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Watch Live
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No runs yet. Click "Run Now" to execute this task.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <TaskModal
          key={editingTask?.id || "new-task"}
          isOpen={isCreateModalOpen}
          onClose={closeTaskModal}
          onSubmit={handleSave}
          title={editingTask ? "Edit Task" : botScope ? "Create Routine" : "Create Task"}
          agents={agents || []}
          sessions={sessions}
          task={editingTask}
          defaultAgentId={initialAgentId}
          defaultSessionId={initialSessionId}
          isLoading={createTask.isPending || updateTask.isPending}
        />

        <ConfirmDialog
          isOpen={!!deletingTask}
          onClose={() => setDeletingTask(null)}
          onConfirm={handleDelete}
          title="Delete Task"
          description={`Are you sure you want to delete "${deletingTask?.name}"? This action cannot be undone.`}
          confirmText="Delete"
          isLoading={deleteTask.isPending}
          variant="danger"
        />
      </div>
    </PageLayout>
  );
}

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  title: string;
  agents: AgentSummary[];
  sessions: Array<{ id: string; title?: string | null }>;
  task: Task | null;
  defaultAgentId: string;
  defaultSessionId: string;
  isLoading: boolean;
}

function TaskModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  agents,
  sessions,
  task,
  defaultAgentId,
  defaultSessionId,
  isLoading,
}: TaskModalProps) {
  const taskSchedule = task?.schedule || "0 * * * *";
  const initialSchedulePreset = schedulePresets.some((preset) => preset.value === taskSchedule)
    ? taskSchedule
    : "custom";
  const [scheduleType, setScheduleType] = useState(initialSchedulePreset);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };

  const agentOptions = [
    { value: "", label: task?.session_id ? "Use chat's agent" : "Gateway default" },
    ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
  ];
  const sessionOptions = [
    { value: "", label: "New chat for each run" },
    ...sessions.map((session) => ({
      value: session.id,
      label: session.title?.trim() || `Chat ${session.id.slice(0, 8)}`,
    })),
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          name="name"
          label="Task Name"
          placeholder="Daily Report Generation"
          defaultValue={task?.name || ""}
          required
        />

        <Textarea
          name="description"
          label="Description (optional)"
          placeholder="What this task does..."
          rows={2}
          defaultValue={task?.description || ""}
        />

        <Select
          key={`agent:${task?.id ?? "new"}:${defaultAgentId}:${agents.length}`}
          name="agent_id"
          label="Agent"
          options={agentOptions}
          defaultValue={task?.agent_id || defaultAgentId}
        />

        <Select
          key={`session:${task?.id ?? "new"}:${defaultSessionId}:${sessions.length}`}
          name="session_id"
          label="Chat context (optional)"
          helperText="Continue in an existing chat or create a separate chat for every run."
          options={sessionOptions}
          defaultValue={task?.session_id || defaultSessionId}
        />

        <Textarea
          name="action"
          label="Action / Prompt"
          placeholder="What should the agent do?"
          rows={3}
          defaultValue={task?.action || ""}
          required
        />

        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">Schedule</label>

          <Select
            name="schedule_preset"
            options={schedulePresets}
            defaultValue={initialSchedulePreset}
            onChange={(value) => setScheduleType(value === "custom" ? "custom" : "preset")}
          />

          {scheduleType === "custom" && (
            <Input
              name="schedule_custom"
              placeholder="*/5 * * * *"
              helperText="Cron expression format: minute hour day month weekday"
              defaultValue={initialSchedulePreset === "custom" ? taskSchedule : ""}
              required
            />
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isLoading}>
            {task ? "Save Task" : "Create Task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
