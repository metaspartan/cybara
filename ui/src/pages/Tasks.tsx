import { useState } from 'react';
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
  Repeat
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Select, Textarea } from '../components/ui/Input';
import {
  useTasks,
  useAgents,
  useCreateTask,
  useDeleteTask,
  useStartTask,
  useStopTask,
  useTriggerTask
} from '../hooks/useApi';
import { useUIStore } from '../stores/uiStore';
import { PageLayout } from '@/components/layout';
import type { Task, Agent } from '../types';

const schedulePresets = [
  { value: '*/5 * * * *', label: 'Every 5 minutes' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 0 * * *', label: 'Daily at midnight' },
  { value: '0 9 * * 1', label: 'Weekly (Monday 9am)' },
  { value: 'custom', label: 'Custom (Cron)' },
];

export function Tasks() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  
  const { data: tasks, isLoading } = useTasks();
  const { data: agents } = useAgents();
  const { addToast } = useUIStore();
  
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const startTask = useStartTask();
  const stopTask = useStopTask();
  const triggerTask = useTriggerTask();

  const filteredTasks = tasks?.filter(task => 
    task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.action.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async (formData: FormData) => {
    try {
      let schedule = formData.get('schedule_preset') as string;
      if (schedule === 'custom') {
        schedule = formData.get('schedule_custom') as string;
      }
      
      await createTask.mutateAsync({
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        schedule,
        agent_id: formData.get('agent_id') as string,
        action: formData.get('action') as string,
        enabled: true,
      });
      addToast('success', 'Task created successfully');
      setIsCreateModalOpen(false);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to create task');
    }
  };

  const handleDelete = async () => {
    if (!deletingTask) return;
    try {
      await deleteTask.mutateAsync(deletingTask.id);
      addToast('success', 'Task deleted successfully');
      setDeletingTask(null);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to delete task');
    }
  };

  const handleToggle = async (task: Task) => {
    try {
      if (task.enabled) {
        await stopTask.mutateAsync(task.id);
        addToast('success', 'Task stopped');
      } else {
        await startTask.mutateAsync(task.id);
        addToast('success', 'Task started');
      }
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to toggle task');
    }
  };

  const handleTrigger = async (task: Task) => {
    try {
      await triggerTask.mutateAsync(task.id);
      addToast('success', 'Task triggered manually');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to trigger task');
    }
  };

  const formatSchedule = (schedule: string) => {
    const preset = schedulePresets.find(p => p.value === schedule);
    return preset?.label || schedule;
  };

  const formatLastRun = (date: string | undefined) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  };

  return (
    <PageLayout
      title="Tasks"
      subtitle="Schedule automated agent tasks"
      actions={
        <Button
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={() => setIsCreateModalOpen(true)}
        >
          Create Task
        </Button>
      }
    >
    <div className="space-y-6">
      {/* Search */}
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

      {/* Tasks List */}
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
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-white">{task.name}</h3>
                        <Badge variant={task.enabled ? 'success' : 'default'} size="sm">
                          {task.enabled ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-sm text-gray-400 mt-1">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
                        <div className="flex items-center gap-1.5 text-gray-400">
                          <Repeat className="w-4 h-4" />
                          <span>{formatSchedule(task.schedule)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-400">
                          <Calendar className="w-4 h-4" />
                          <span>Last run: {formatLastRun(task.last_run)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Zap className="w-4 h-4" />}
                      onClick={() => handleTrigger(task)}
                      isLoading={triggerTask.isPending}
                    >
                      Run Now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={task.enabled ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      onClick={() => handleToggle(task)}
                    >
                      {task.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 className="w-4 h-4" />}
                      onClick={() => setDeletingTask(task)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <TaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreate}
        title="Create Task"
        agents={agents || []}
        isLoading={createTask.isPending}
      />

      {/* Delete Confirmation */}
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
  const [scheduleType, setScheduleType] = useState('preset');
  
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };

  const agentOptions = agents.map(a => ({ value: a.id, label: a.name }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          name="name"
          label="Task Name"
          placeholder="Daily Report Generation"
          required
        />
        
        <Textarea
          name="description"
          label="Description (optional)"
          placeholder="What this task does..."
          rows={2}
        />
        
        <Select
          name="agent_id"
          label="Agent"
          options={agentOptions}
          required
        />
        
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
            onChange={(value) => setScheduleType(value === 'custom' ? 'custom' : 'preset')}
          />
          
          {scheduleType === 'custom' && (
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
