import { Brain, LibraryBig } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface GraphNode {
  id: string;
  kind: "skill" | "memory";
  title: string;
  category: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  kind: "category" | "topic";
}

interface Positioned extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

const WIDTH = 760;
const HEIGHT = 460;

function seededRandom(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}

function layout(nodes: GraphNode[], edges: GraphEdge[]): Positioned[] {
  const rand = seededRandom(nodes.length * 97 + edges.length * 13 + 1);
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const positioned: Positioned[] = nodes.map((node) => {
    const angle = (hashId(node.id) % 360) * (Math.PI / 180);
    const radius = 60 + rand() * 160;
    return {
      ...node,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      degree: degree.get(node.id) ?? 0,
    };
  });
  const index = new Map(positioned.map((node) => [node.id, node]));

  const margin = 40;
  for (let iteration = 0; iteration < 340; iteration += 1) {
    const cooling = 1 - iteration / 340;
    for (let i = 0; i < positioned.length; i += 1) {
      for (let j = i + 1; j < positioned.length; j += 1) {
        const a = positioned[i];
        const b = positioned[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 0.01) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          distSq = 0.01;
        }
        const force = 4600 / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const edge of edges) {
      const a = index.get(edge.source);
      const b = index.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = edge.kind === "topic" ? 84 : 108;
      const spring = (dist - target) * 0.016;
      const fx = (dx / dist) * spring;
      const fy = (dy / dist) * spring;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    const centerPull = 0.0038;
    const wallForce = 90;
    for (const node of positioned) {
      node.vx += (WIDTH / 2 - node.x) * centerPull;
      node.vy += (HEIGHT / 2 - node.y) * centerPull;
      node.vx += wallForce / Math.max(12, node.x - margin);
      node.vx -= wallForce / Math.max(12, WIDTH - margin - node.x);
      node.vy += wallForce / Math.max(12, node.y - margin);
      node.vy -= wallForce / Math.max(12, HEIGHT - margin - node.y);
      node.vx *= 0.88;
      node.vy *= 0.88;
      node.x += node.vx * cooling;
      node.y += node.vy * cooling;
      if (node.x < margin) {
        node.x = margin;
        node.vx = Math.abs(node.vx) * 0.3;
      } else if (node.x > WIDTH - margin) {
        node.x = WIDTH - margin;
        node.vx = -Math.abs(node.vx) * 0.3;
      }
      if (node.y < margin) {
        node.y = margin;
        node.vy = Math.abs(node.vy) * 0.3;
      } else if (node.y > HEIGHT - margin) {
        node.y = HEIGHT - margin;
        node.vy = -Math.abs(node.vy) * 0.3;
      }
    }
  }
  return positioned;
}

export function MemoryGraph({
  nodes,
  edges,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect?: (id: string | null) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const positioned = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const index = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);

  useEffect(() => {
    onSelect?.(hovered);
  }, [hovered, onSelect]);

  const connectedIds = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    for (const edge of edges) {
      if (edge.source === hovered) set.add(edge.target);
      if (edge.target === hovered) set.add(edge.source);
    }
    return set;
  }, [hovered, edges]);

  if (nodes.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)]"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[460px] w-full"
        role="img"
        aria-label="Memory and skill relationship graph"
      >
        <defs>
          <radialGradient id="graph-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(124,123,240,0.16)" />
            <stop offset="100%" stopColor="rgba(124,123,240,0)" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#graph-glow)" />
        {edges.map((edge, i) => {
          const a = index.get(edge.source);
          const b = index.get(edge.target);
          if (!a || !b) return null;
          const active =
            !connectedIds || (connectedIds.has(edge.source) && connectedIds.has(edge.target));
          return (
            <line
              key={`${edge.source}-${edge.target}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={edge.kind === "topic" ? "rgb(124,123,240)" : "rgb(120,130,150)"}
              strokeOpacity={active ? (edge.kind === "topic" ? 0.5 : 0.28) : 0.06}
              strokeWidth={edge.kind === "topic" ? 1.4 : 1}
            />
          );
        })}
        {positioned.map((node) => {
          const active = !connectedIds || connectedIds.has(node.id);
          const radius = 5 + Math.min(6, node.degree);
          const isSkill = node.kind === "skill";
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              opacity={active ? 1 : 0.25}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle
                r={radius}
                fill={isSkill ? "rgb(124,123,240)" : "rgb(56,189,180)"}
                stroke="var(--surface-panel)"
                strokeWidth={1.5}
              />
              {(node.id === hovered || node.degree >= 7) && (
                <text
                  x={radius + 4}
                  y={4}
                  fontSize={11}
                  fill="var(--text-secondary)"
                  className="pointer-events-none select-none"
                >
                  {node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5 rounded-lg bg-[var(--surface-backdrop)]/80 px-2.5 py-2 text-[10px] backdrop-blur">
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <LibraryBig className="h-3 w-3 text-[rgb(124,123,240)]" /> Skill
        </span>
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Brain className="h-3 w-3 text-[rgb(56,189,180)]" /> Memory
        </span>
      </div>
      {hovered && index.get(hovered) ? (
        <div className="pointer-events-none absolute bottom-3 right-3 max-w-[60%] rounded-lg border border-[var(--surface-border)] bg-[var(--surface-backdrop)]/90 px-3 py-2 text-xs backdrop-blur">
          <span className="font-medium text-gray-100">{index.get(hovered)?.title}</span>
          <span className="ml-2 text-[var(--text-muted)]">{index.get(hovered)?.category}</span>
        </div>
      ) : null}
    </div>
  );
}
