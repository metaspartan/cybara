import { useState } from "react";
import {
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
  useAgents,
  useCreateTask,
  useDeleteTask,
  useStartTask,
  useStopTask,
  useTriggerTask,
} from "../hooks/useApi";
import { useUIStore } from "../stores/uiStore";
import { PageLayout } from "@/components/layout";
import type { Task, Agent } from "../types";
import { useTaskNotifications } from "../hooks/useNotifications";
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const { permission, requestPermission, connected } = useTaskNotifications();

  const { data: tasks, isLoading } = useTasks();
  const { data: agents } = useAgents();
  const { addToast } = useUIStore();

  const createTask = useCreateTask();
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

  const filteredTasks = tasks?.filter(
    (task) =>
      task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.action.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async (formData: FormData) => {
    try {
      let schedule = formData.get("schedule_preset") as string;
      if (schedule === "custom") {
        schedule = formData.get("schedule_custom") as string;
      }

      await createTask.mutateAsync({
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        schedule,
        agent_id: formData.get("agent_id") as string,
        action: formData.get("action") as string,
        enabled: true,
      });
      addToast("success", "Task created successfully");
      setIsCreateModalOpen(false);
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
      title="Tasks"
      subtitle="Schedule automated agent tasks"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
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
            onClick={() => setIsCreateModalOpen(true)}
          >
            Create Task
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
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
              <h3 className="text-lg font-medium text-white mb-2">No tasks found</h3>
              <p className="text-gray-400 mb-4">Create your first scheduled task</p>
              <Button onClick={() => setIsCreateModalOpen(true)}>Create Task</Button>
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
                          <div className="flex min-w-0 items-center gap-1.5 text-gray-400">
                            <Calendar className="w-4 h-4" />
                            <span className="min-w-0 break-words">
                              Last run: {formatLastRun(task.last_run)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Zap className="w-4 h-4" />}
                        onClick={() => handleTrigger(task)}
                        isLoading={triggerTask.isPending}
                        className="w-full sm:w-auto"
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
                        className="w-full sm:w-auto"
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
                        className="w-full sm:w-auto"
                      >
                        History
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setDeletingTask(task)}
                        className="w-full sm:w-auto"
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
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreate}
          title="Create Task"
          agents={agents || []}
          isLoading={createTask.isPending}
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
  agents: Agent[];
  isLoading: boolean;
}

function TaskModal({ isOpen, onClose, onSubmit, title, agents, isLoading }: TaskModalProps) {
  const [scheduleType, setScheduleType] = useState("preset");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };

  const agentOptions = agents.map((a) => ({ value: a.id, label: a.name }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input name="name" label="Task Name" placeholder="Daily Report Generation" required />

        <Textarea
          name="description"
          label="Description (optional)"
          placeholder="What this task does..."
          rows={2}
        />

        <Select name="agent_id" label="Agent" options={agentOptions} required />

        <Textarea
          name="action"
          label="Action / Prompt"
          placeholder="What should the agent do?"
          rows={3}
          required
        />

        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">Schedule</label>

          <Select
            name="schedule_preset"
            options={schedulePresets}
            defaultValue="0 * * * *"
            onChange={(value) => setScheduleType(value === "custom" ? "custom" : "preset")}
          />

          {scheduleType === "custom" && (
            <Input
              name="schedule_custom"
              placeholder="*/5 * * * *"
              helperText="Cron expression format: minute hour day month weekday"
              required
            />
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isLoading}>
            Create Task
          </Button>
        </div>
      </form>
    </Modal>
  );
}
