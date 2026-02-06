import { tables, type Task } from "./database";
import { agentManager } from "./agent";

class TaskScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private tasks: Map<string, { task: Task; handler: () => Promise<void> }> = new Map();
  private initialized = false;

  list(): Task[] {
    const rawTasks = tables.tasks.all() as Task[];
    // Normalize tasks to include enabled status for UI
    return rawTasks.map(t => ({
      ...t,
      config: typeof t.config === 'string' ? JSON.parse(t.config) : t.config,
      enabled: t.status === 'running' || t.status === 'pending',
    }));
  }

  get(id: string): Task | undefined {
    const task = tables.tasks.get(id) as Task | undefined;
    if (task && typeof task.config === 'string') {
      try {
        task.config = JSON.parse(task.config);
      } catch { /* ignore parse errors */ }
    }
    return task;
  }

  create(data: {
    name: string;
    description?: string;
    action?: string;
    type?: "scheduled" | "triggered" | "recurring";
    agent_id?: string;
    schedule?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }): Task {
    const id = crypto.randomUUID();
    const next_run = this.calculateNextRun(data.schedule);

    // Store action and description in config
    const config = {
      ...(data.config || {}),
      action: data.action || data.name,
      description: data.description || '',
    };

    const task: Task = {
      id,
      name: data.name,
      type: data.type || "scheduled",
      agent_id: data.agent_id,
      schedule: data.schedule,
      config,
      status: data.enabled !== false ? "pending" : "paused",
      next_run,
    };

    tables.tasks.create(task);

    // Auto-start if enabled
    if (data.enabled !== false && data.schedule) {
      this.scheduleTask(task);
    }

    console.log(`[Task] Created: ${task.name} (${task.id})`);
    return { ...task, enabled: data.enabled !== false };
  }

  async start(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;

    tables.tasks.update(id, { status: "pending", last_run: undefined, next_run: this.calculateNextRun(task.schedule) });
    this.scheduleTask(task);
    console.log(`[Task] Started: ${task.name}`);
    return true;
  }

  async stop(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;

    tables.tasks.update(id, { status: "paused", next_run: undefined });
    this.tasks.delete(id);
    console.log(`[Task] Stopped: ${task.name}`);
    return true;
  }

  async trigger(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;
    console.log(`[Task] Triggering: ${task.name}`);
    await this.executeTask(task);
    return true;
  }

  delete(id: string): boolean {
    this.tasks.delete(id);
    const result = tables.tasks.delete(id);
    return result.changes > 0;
  }

  private scheduleTask(task: Task): void {
    this.tasks.set(task.id, {
      task,
      handler: async () => await this.executeTask(task),
    });

    // Auto-start scheduler if not running
    this.startScheduler();
  }

  private async executeTask(task: Task): Promise<void> {
    console.log(`[Task] Executing: ${task.name}`);
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // Log run start
    tables.taskRuns.create({
      id: runId,
      task_id: task.id,
      status: "running",
      started_at: startedAt,
    });

    tables.tasks.update(task.id, { status: "running", last_run: startedAt });

    try {
      // Get the action from config
      const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});
      const action = config.action || config.description || task.name;

      // Find the agent (specific or any available)
      const agent = task.agent_id
        ? agentManager.get(task.agent_id)
        : agentManager.list().find(a => a.status === "running") || agentManager.list()[0];

      if (!agent) {
        throw new Error("No agent available for task execution");
      }

      // Import handleChat dynamically to avoid circular imports
      const { handleChat } = await import("../api/chat");

      // Execute via handleChat - this creates a proper persistent session!
      console.log(`[Task] Calling agent ${agent.name} with: "${action.slice(0, 100)}..."`);
      const result = await handleChat({
        message: action,
        agentId: agent.id,
        sessionId: `task:${task.id}:${Date.now()}`, // Unique session per task run
      });

      console.log(`[Task] Completed: ${task.name} - Session: ${result.sessionId}`);

      // Log run completion
      const resultPreview = result.message?.content?.slice(0, 200);
      tables.taskRuns.complete(runId, {
        status: "completed",
        session_id: result.sessionId,
        result_preview: resultPreview,
      });

      // Broadcast task_completed event for browser notifications
      const { broadcastTaskEvent } = await import("./status");
      broadcastTaskEvent({
        type: "task_completed",
        taskId: task.id,
        taskName: task.name,
        status: "completed",
        sessionId: result.sessionId,
        resultPreview,
      });

      // Update status based on schedule
      if (task.schedule) {
        const next_run = this.calculateNextRun(task.schedule);
        tables.tasks.update(task.id, { status: "pending", next_run });
        console.log(`[Task] Next run scheduled: ${next_run}`);
      } else {
        tables.tasks.update(task.id, { status: "completed" });
      }
    } catch (error) {
      console.error(`[Task] Error executing ${task.name}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log run failure
      tables.taskRuns.complete(runId, {
        status: "failed",
        error: errorMsg.slice(0, 500),
      });

      // Broadcast failure event
      const { broadcastTaskEvent } = await import("./status");
      broadcastTaskEvent({
        type: "task_completed",
        taskId: task.id,
        taskName: task.name,
        status: "failed",
        error: errorMsg.slice(0, 200),
      });

      tables.tasks.update(task.id, { status: "failed" });
    }
  }

  private calculateNextRun(schedule?: string): string | undefined {
    if (!schedule) return undefined;

    const now = new Date();

    // Parse cron expression (simplified - handles common cases)
    const parts = schedule.trim().split(/\s+/);
    if (parts.length >= 5) {
      const minute = parts[0];
      const hour = parts[1];

      // Handle */N intervals
      if (minute.startsWith('*/')) {
        const interval = parseInt(minute.slice(2));
        if (!isNaN(interval) && interval > 0) {
          const next = new Date(now.getTime() + interval * 60 * 1000);
          return next.toISOString();
        }
      }

      // Handle specific minute (e.g., "0 * * * *" = every hour at :00)
      if (minute === '0' && hour === '*') {
        now.setMinutes(0, 0, 0);
        now.setHours(now.getHours() + 1);
        return now.toISOString();
      }

      // Handle specific hour intervals (e.g., "0 */6 * * *")
      if (minute === '0' && hour.startsWith('*/')) {
        const interval = parseInt(hour.slice(2));
        if (!isNaN(interval) && interval > 0) {
          const next = new Date(now.getTime() + interval * 60 * 60 * 1000);
          return next.toISOString();
        }
      }
    }

    // Default: 1 hour
    now.setHours(now.getHours() + 1);
    return now.toISOString();
  }

  startScheduler(): void {
    if (this.interval) return;

    console.log("[Task] Starting scheduler loop (60s interval)");
    this.interval = setInterval(async () => {
      const now = new Date();
      for (const [id, { task, handler }] of this.tasks) {
        // Reload task to get latest status
        const currentTask = this.get(id);
        if (!currentTask) {
          this.tasks.delete(id);
          continue;
        }

        if (currentTask.next_run && new Date(currentTask.next_run) <= now && currentTask.status === "pending") {
          console.log(`[Task] Time to run: ${currentTask.name}`);
          await handler();
        }
      }
    }, 60000);
  }

  stopScheduler(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[Task] Scheduler stopped");
    }
  }

  // Initialize: load all pending tasks and start scheduler
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const allTasks = tables.tasks.all() as Task[];
    const pendingTasks = allTasks.filter(t => t.status === 'pending' && t.schedule);

    console.log(`[Task] Initializing scheduler with ${pendingTasks.length} pending tasks`);

    for (const task of pendingTasks) {
      this.scheduleTask(task);
    }

    if (pendingTasks.length > 0) {
      this.startScheduler();
    }
  }

  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    paused: number;
  } {
    const all = tables.tasks.all() as Task[];
    return {
      total: all.length,
      pending: all.filter((t) => t.status === "pending").length,
      running: all.filter((t) => t.status === "running").length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
      paused: all.filter((t) => t.status === "paused").length,
    };
  }
}

export const taskScheduler = new TaskScheduler();

