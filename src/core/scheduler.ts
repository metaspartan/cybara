import { tables, type Task } from "./database";

class TaskScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private tasks: Map<string, { task: Task; handler: () => Promise<void> }> = new Map();

  list(): Task[] {
    return tables.tasks.all() as Task[];
  }

  get(id: string): Task | undefined {
    return tables.tasks.get(id) as Task | undefined;
  }

  create(data: {
    name: string;
    type?: "scheduled" | "triggered" | "recurring";
    agent_id?: string;
    schedule?: string;
    config?: Record<string, unknown>;
  }): Task {
    const id = crypto.randomUUID();
    const next_run = this.calculateNextRun(data.schedule);

    const task: Task = {
      id,
      name: data.name,
      type: data.type || "scheduled",
      agent_id: data.agent_id,
      schedule: data.schedule,
      config: data.config || {},
      status: "pending",
      next_run,
    };

    tables.tasks.create(task);
    return task;
  }

  async start(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;

    tables.tasks.update(id, { status: "running" });

    this.tasks.set(id, {
      task,
      handler: async () => await this.executeTask(task),
    });

    if (task.schedule) this.startScheduler();
    return true;
  }

  async stop(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;

    tables.tasks.update(id, { status: "paused" });
    this.tasks.delete(id);
    return true;
  }

  async trigger(id: string): Promise<boolean> {
    const task = this.get(id);
    if (!task) return false;
    await this.executeTask(task);
    return true;
  }

  delete(id: string): boolean {
    this.tasks.delete(id);
    const result = tables.tasks.delete(id);
    return result.changes > 0;
  }

  private async executeTask(task: Task): Promise<void> {
    tables.tasks.update(task.id, { status: "running", last_run: new Date().toISOString() });

    try {
      console.log(`[Task] Executing: ${task.name}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      tables.tasks.update(task.id, { status: "completed" });
    } catch (error) {
      tables.tasks.update(task.id, { status: "failed" });
      console.error(`[Task] Error: ${task.name}`, error);
    }

    if (task.schedule) {
      const next_run = this.calculateNextRun(task.schedule);
      tables.tasks.update(task.id, { next_run });
    }
  }

  private calculateNextRun(schedule?: string): string | undefined {
    if (!schedule) return undefined;

    const now = new Date();

    // Handle cron-like schedules
    if (schedule.includes("*") || schedule.includes(" ")) {
      const parts = schedule.split(/[\s,]+/);
      if (parts.length >= 2) {
        const minute = parseInt(parts[0]);
        if (!isNaN(minute) && minute > 0) {
          now.setMinutes(now.getMinutes() + minute);
          return now.toISOString();
        }
      }
    }

    // Default: 1 hour
    now.setHours(now.getHours() + 1);
    return now.toISOString();
  }

  private startScheduler(): void {
    if (this.interval) return;
    this.interval = setInterval(async () => {
      const now = new Date();
      for (const [id, { task, handler }] of this.tasks) {
        if (task.next_run && new Date(task.next_run) <= now && task.status !== "running") {
          await handler();
        }
      }
    }, 60000);
  }

  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    const all = this.list();
    return {
      total: all.length,
      pending: all.filter((t) => t.status === "pending").length,
      running: all.filter((t) => t.status === "running").length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
    };
  }
}

export const taskScheduler = new TaskScheduler();
