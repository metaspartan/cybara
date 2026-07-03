import { tables, type Task } from "./database";
import { agentManager } from "./agent";
import { handleChat } from "../api/chat";
import { broadcastTaskEvent } from "./status";
import { parseCronExpression } from "./cron/cron-expr";

function parseTaskConfig(config: unknown, taskId?: string): Record<string, unknown> {
  if (typeof config === "string") {
    try {
      const parsed = JSON.parse(config);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      console.warn(
        `[Task] Invalid task config JSON${taskId ? ` for ${taskId}` : ""}; using empty config`
      );
      return {};
    }
  }

  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }

  return {};
}

class TaskScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private tasks: Map<string, { task: Task; handler: () => Promise<void> }> = new Map();
  private initialized = false;

  private taskWithEnabled(task: Task): Task {
    return {
      ...task,
      config: parseTaskConfig(task.config, task.id),
      enabled: task.status === "running" || task.status === "pending",
    };
  }

  private validateTaskInput(data: { name?: string; schedule?: string }): void {
    if (typeof data?.name === "string" && !data.name.trim()) {
      throw new Error("Validation error: Task name is required");
    }
    if (data.schedule !== undefined && data.schedule !== "") {
      if (typeof data.schedule !== "string") {
        throw new Error("Validation error: schedule must be a cron string");
      }
      try {
        parseCronExpression(data.schedule);
      } catch (error) {
        throw new Error(
          `Validation error: Invalid cron schedule: ${(error as Error).message}`
        );
      }
    }
  }

  list(): Task[] {
    const rawTasks = tables.tasks.all() as Task[];
    return rawTasks.map((task) => this.taskWithEnabled(task));
  }

  get(id: string): Task | undefined {
    const task = tables.tasks.get(id) as Task | undefined;
    return task ? this.taskWithEnabled(task) : undefined;
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
    if (typeof data?.name !== "string" || !data.name.trim()) {
      throw new Error("Validation error: Task name is required");
    }
    this.validateTaskInput(data);

    const id = crypto.randomUUID();
    const next_run = this.calculateNextRun(data.schedule);

    const config = {
      ...(data.config || {}),
      action: data.action || data.name,
      description: data.description || "",
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

    if (data.enabled !== false && data.schedule) {
      this.scheduleTask(task);
    }

    console.log(`[Task] Created: ${task.name} (${task.id})`);
    return { ...task, enabled: data.enabled !== false };
  }

  update(
    id: string,
    data: {
      name?: string;
      description?: string;
      action?: string;
      type?: "scheduled" | "triggered" | "recurring";
      agent_id?: string | null;
      agentId?: string | null;
      schedule?: string | null;
      config?: Record<string, unknown>;
      enabled?: boolean;
      status?: Task["status"];
    }
  ): Task | undefined {
    const current = this.get(id);
    if (!current) return undefined;

    this.validateTaskInput({
      name: data.name,
      schedule: data.schedule === null ? "" : data.schedule,
    });

    const config = {
      ...parseTaskConfig(current.config, current.id),
      ...(data.config || {}),
    };
    if (data.action !== undefined) config.action = data.action;
    if (data.description !== undefined) config.description = data.description;

    const agentId =
      data.agent_id !== undefined
        ? data.agent_id
        : data.agentId !== undefined
          ? data.agentId
          : current.agent_id;
    const schedule =
      data.schedule !== undefined
        ? data.schedule === null || data.schedule === ""
          ? undefined
          : data.schedule
        : current.schedule;
    const requestedStatus =
      data.enabled !== undefined
        ? data.enabled
          ? "pending"
          : "paused"
        : data.status;
    const status = requestedStatus || current.status || "pending";
    const nextRun =
      status === "paused"
        ? undefined
        : status === "pending" && schedule
          ? this.calculateNextRun(schedule)
          : current.next_run;

    const task: Task = {
      ...current,
      agent_id: agentId || undefined,
      name: data.name?.trim() || current.name,
      type: data.type || current.type || "scheduled",
      schedule,
      config,
      status,
      next_run: nextRun,
    };

    tables.tasks.replace(id, task);
    this.tasks.delete(id);
    if (task.status === "pending" && task.schedule) {
      this.scheduleTask(task);
    }

    console.log(`[Task] Updated: ${task.name} (${task.id})`);
    return this.taskWithEnabled(task);
  }

  async start(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;

    tables.tasks.update(id, {
      status: "pending",
      last_run: undefined,
      next_run: this.calculateNextRun(task.schedule),
    });
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

    this.startScheduler();
  }

  private async executeTask(task: Task): Promise<void> {
    console.log(`[Task] Executing: ${task.name}`);
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    tables.taskRuns.create({
      id: runId,
      task_id: task.id,
      status: "running",
      started_at: startedAt,
    });

    tables.tasks.update(task.id, { status: "running", last_run: startedAt });

    try {
      const config = parseTaskConfig(task.config, task.id);
      const actionValue = config.action ?? config.description;
      const action =
        typeof actionValue === "string" && actionValue.trim().length > 0 ? actionValue : task.name;

      const agent = task.agent_id
        ? agentManager.get(task.agent_id)
        : agentManager.list().find((a) => a.status === "running") || agentManager.list()[0];

      if (!agent) {
        throw new Error("No agent available for task execution");
      }

      console.log(`[Task] Calling agent ${agent.name} with: "${action.slice(0, 100)}..."`);
      const result = await handleChat({
        message: action,
        agentId: agent.id,
        sessionId: `task:${task.id}:${Date.now()}`, // Unique session per task run
      });

      console.log(`[Task] Completed: ${task.name} - Session: ${result.sessionId}`);

      const resultPreview = result.message?.content?.slice(0, 200);
      tables.taskRuns.complete(runId, {
        status: "completed",
        session_id: result.sessionId,
        result_preview: resultPreview,
      });

      broadcastTaskEvent({
        type: "task_completed",
        taskId: task.id,
        taskName: task.name,
        status: "completed",
        sessionId: result.sessionId,
        resultPreview,
      });

      const completedAt = new Date().toISOString();
      if (task.schedule) {
        const next_run = this.calculateNextRun(task.schedule);
        tables.tasks.update(task.id, { status: "pending", last_run: completedAt, next_run });
        console.log(`[Task] Next run scheduled: ${next_run}`);
      } else {
        tables.tasks.update(task.id, { status: "completed", last_run: completedAt });
      }
    } catch (error) {
      console.error(`[Task] Error executing ${task.name}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      tables.taskRuns.complete(runId, {
        status: "failed",
        error: errorMsg.slice(0, 500),
      });

      broadcastTaskEvent({
        type: "task_completed",
        taskId: task.id,
        taskName: task.name,
        status: "failed",
        error: errorMsg.slice(0, 200),
      });

      tables.tasks.update(task.id, { status: "failed", last_run: new Date().toISOString() });
    }
  }

  private calculateNextRun(schedule?: string): string | undefined {
    if (!schedule) return undefined;

    const now = new Date();

    const parts = schedule.trim().split(/\s+/);
    if (parts.length >= 5) {
      const [minutePart, hourPart, , , dowPart] = parts;

      if (minutePart.startsWith("*/")) {
        const interval = parseInt(minutePart.slice(2));
        if (!isNaN(interval) && interval > 0) {
          const next = new Date(now.getTime() + interval * 60 * 1000);
          return next.toISOString();
        }
      }

      if (minutePart === "0" && hourPart === "*") {
        const next = new Date(now);
        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);
        return next.toISOString();
      }

      if (minutePart === "0" && hourPart.startsWith("*/")) {
        const interval = parseInt(hourPart.slice(2));
        if (!isNaN(interval) && interval > 0) {
          const next = new Date(now.getTime() + interval * 60 * 60 * 1000);
          return next.toISOString();
        }
      }

      const targetMinute = parseInt(minutePart);
      const targetHour = parseInt(hourPart);
      if (!isNaN(targetMinute) && !isNaN(targetHour)) {
        const next = new Date(now);
        next.setSeconds(0, 0);
        next.setMinutes(targetMinute);
        next.setHours(targetHour);

        if (dowPart !== "*" && dowPart !== "?") {
          const targetDow = parseInt(dowPart); // 0=Sun, 1=Mon, ..., 6=Sat
          if (!isNaN(targetDow)) {
            const currentDow = next.getDay();
            let daysAhead = targetDow - currentDow;
            if (daysAhead < 0) daysAhead += 7;
            if (daysAhead === 0 && next <= now) daysAhead = 7;
            next.setDate(next.getDate() + daysAhead);
            return next.toISOString();
          }
        }

        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next.toISOString();
      }
    }

    const fallback = new Date(now.getTime() + 60 * 60 * 1000);
    return fallback.toISOString();
  }

  startScheduler(): void {
    if (this.interval) return;

    console.log("[Task] Starting scheduler loop (60s interval)");
    this.interval = setInterval(async () => {
      const now = new Date();
      for (const [id, { handler }] of this.tasks) {
        const currentTask = this.get(id);
        if (!currentTask) {
          this.tasks.delete(id);
          continue;
        }

        if (
          currentTask.next_run &&
          new Date(currentTask.next_run) <= now &&
          currentTask.status === "pending"
        ) {
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

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const allTasks = tables.tasks.all() as Task[];
    const pendingTasks = allTasks.filter((t) => t.status === "pending" && t.schedule);

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
