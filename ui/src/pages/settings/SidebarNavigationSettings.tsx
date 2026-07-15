import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  BarChart3,
  Code,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  GripVertical,
  LayoutDashboard,
  ListTodo,
  MessagesSquare,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  SquareTerminal,
  Volume2,
  Wallet,
} from "lucide-react";
import { type DragEvent, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useSidebarNavigationLayout } from "@/hooks/useSidebarNavigationLayout";
import {
  moveSidebarNavigationItem,
  type SidebarDestinationId,
  type SidebarNavigationZone,
  type SidebarPrimaryItemId,
} from "@/lib/sidebarNavigation";
import { cn } from "@/lib/utils";

const navigationPresentation: Record<
  SidebarPrimaryItemId,
  { label: string; description: string; icon: typeof LayoutDashboard }
> = {
  dashboard: {
    label: "Dashboard",
    description: "System overview and quick actions",
    icon: LayoutDashboard,
  },
  ide: { label: "IDE", description: "Workspace editor and development tools", icon: FolderOpen },
  usage: { label: "Usage", description: "Provider plan and token usage", icon: Gauge },
  voice: { label: "Voice", description: "Realtime voice and speech", icon: Volume2 },
  lab: { label: "Lab", description: "Evals, benchmarks, and datasets", icon: FlaskConical },
  terminal: {
    label: "Terminal",
    description: "Interactive gateway terminal",
    icon: SquareTerminal,
  },
  lsp: { label: "LSP", description: "Language server management", icon: Code },
  sessions: {
    label: "Sessions",
    description: "Session operations and history",
    icon: MessagesSquare,
  },
  journey: { label: "Journey", description: "Activity and progress timeline", icon: Sparkles },
  wallet: { label: "Wallet", description: "Portfolio and wallet operations", icon: Wallet },
  artifacts: { label: "Artifacts", description: "Generated files and outputs", icon: FileText },
  metrics: { label: "Metrics", description: "Runtime and performance analytics", icon: BarChart3 },
  tasks: { label: "Tasks", description: "Scheduled and active tasks", icon: ListTodo },
  more: { label: "More", description: "Menu for additional destinations", icon: MoreHorizontal },
};

interface NavigationZoneProps {
  title: string;
  zone: SidebarNavigationZone;
  items: SidebarPrimaryItemId[];
  draggedItem: SidebarPrimaryItemId | null;
  onDragStart: (event: DragEvent<HTMLElement>, item: SidebarPrimaryItemId) => void;
  onDragEnd: () => void;
  onDrop: (
    event: DragEvent<HTMLElement>,
    zone: SidebarNavigationZone,
    target?: SidebarPrimaryItemId
  ) => void;
  onMoveOffset: (zone: SidebarNavigationZone, item: SidebarPrimaryItemId, offset: -1 | 1) => void;
  onMoveZone: (item: SidebarDestinationId, zone: SidebarNavigationZone) => void;
}

function NavigationZone({
  title,
  zone,
  items,
  draggedItem,
  onDragStart,
  onDragEnd,
  onDrop,
  onMoveOffset,
  onMoveZone,
}: NavigationZoneProps) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, zone)}
    >
      <div className="border-b border-[var(--surface-border)] px-3 py-2.5">
        <h3 className="theme-text-primary text-xs font-semibold">{title}</h3>
      </div>
      <div className="min-h-14">
        {items.length === 0 ? (
          <p className="theme-text-muted px-3 py-4 text-center text-xs">Drag destinations here</p>
        ) : (
          items.map((item, index) => {
            const presentation = navigationPresentation[item];
            const Icon = presentation.icon;
            const canMoveZone = item !== "more";
            return (
              <div
                key={item}
                draggable
                onDragStart={(event) => onDragStart(event, item)}
                onDragEnd={onDragEnd}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  onDrop(event, zone, item);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 transition-colors",
                  index > 0 && "border-t border-[var(--surface-border)]",
                  draggedItem === item ? "bg-[rgba(var(--accent-primary),0.1)] opacity-65" : ""
                )}
              >
                <GripVertical className="theme-text-subtle h-4 w-4 shrink-0 cursor-grab" />
                <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--accent-primary))]" />
                <div className="min-w-0 flex-1">
                  <p className="theme-text-primary truncate text-sm font-medium">
                    {presentation.label}
                  </p>
                  <p className="theme-text-muted truncate text-[11px]">
                    {presentation.description}
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  {canMoveZone ? (
                    <button
                      type="button"
                      onClick={() => onMoveZone(item, zone === "primary" ? "more" : "primary")}
                      className="theme-text-muted rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      title={zone === "primary" ? "Move into More" : "Move to main sidebar"}
                      aria-label={`${zone === "primary" ? "Move into More" : "Move to main sidebar"}: ${presentation.label}`}
                    >
                      {zone === "primary" ? (
                        <ArrowRightToLine className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowLeftToLine className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onMoveOffset(zone, item, -1)}
                    disabled={index === 0}
                    className="theme-text-muted rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-25"
                    title={`Move ${presentation.label} up`}
                    aria-label={`Move ${presentation.label} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveOffset(zone, item, 1)}
                    disabled={index === items.length - 1}
                    className="theme-text-muted rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-25"
                    title={`Move ${presentation.label} down`}
                    aria-label={`Move ${presentation.label} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function SidebarNavigationSettings() {
  const { layout, setLayout, resetLayout } = useSidebarNavigationLayout();
  const [draggedItem, setDraggedItem] = useState<SidebarPrimaryItemId | null>(null);

  const dropItem = (
    event: DragEvent<HTMLElement>,
    zone: SidebarNavigationZone,
    target?: SidebarPrimaryItemId
  ) => {
    event.preventDefault();
    const source = draggedItem;
    setDraggedItem(null);
    if (!source) return;
    setLayout(moveSidebarNavigationItem(layout, source, zone, target));
  };

  const moveByOffset = (
    zone: SidebarNavigationZone,
    item: SidebarPrimaryItemId,
    offset: -1 | 1
  ) => {
    const items = zone === "primary" ? layout.primary : layout.more;
    const currentIndex = items.indexOf(item as SidebarDestinationId);
    const target = items[currentIndex + offset];
    if (!target) return;
    setLayout(moveSidebarNavigationItem(layout, item, zone, target));
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Sidebar Navigation</CardTitle>
          <CardDescription>
            Drag destinations between the main sidebar and More, then arrange each list.
          </CardDescription>
        </div>
        <button
          type="button"
          onClick={resetLayout}
          className="theme-text-muted rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          title="Reset navigation layout"
          aria-label="Reset navigation layout"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 xl:grid-cols-2">
          <NavigationZone
            title="Main sidebar"
            zone="primary"
            items={layout.primary}
            draggedItem={draggedItem}
            onDragStart={(event, item) => {
              setDraggedItem(item);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item);
            }}
            onDragEnd={() => setDraggedItem(null)}
            onDrop={dropItem}
            onMoveOffset={moveByOffset}
            onMoveZone={(item, zone) => setLayout(moveSidebarNavigationItem(layout, item, zone))}
          />
          <NavigationZone
            title="Inside More"
            zone="more"
            items={layout.more}
            draggedItem={draggedItem}
            onDragStart={(event, item) => {
              setDraggedItem(item);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item);
            }}
            onDragEnd={() => setDraggedItem(null)}
            onDrop={dropItem}
            onMoveOffset={moveByOffset}
            onMoveZone={(item, zone) => setLayout(moveSidebarNavigationItem(layout, item, zone))}
          />
        </div>
      </CardContent>
    </Card>
  );
}
