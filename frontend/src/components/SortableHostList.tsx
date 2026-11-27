import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useState, type ReactNode } from "react";
import { t } from "../i18n";
import { cn } from "../lib/utils";
import type { Host, Language } from "../types";

const closestHostInGroup: CollisionDetection = (args) => closestCenter({
  ...args,
  droppableContainers: args.droppableContainers.filter(
    (item) => item.data.current?.pinned === args.active.data.current?.pinned,
  ),
});

function SortableHost(props: {
  host: Host;
  language: Language;
  canMove: boolean;
  pending: boolean;
  renderHost: (host: Host, dragHandle?: ReactNode) => ReactNode;
}) {
  const { host, language, canMove } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: host.id,
    data: { pinned: host.pinned },
    disabled: !canMove || props.pending,
  });
  const handle = canMove && (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="grid h-9 w-8 shrink-0 touch-none cursor-grab place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 active:cursor-grabbing disabled:cursor-wait dark:hover:bg-slate-800 dark:hover:text-slate-100"
      {...attributes}
      {...listeners}
      disabled={props.pending}
      title={t(language, "reorderHostHint")}
      aria-label={t(language, "reorderHost").replace("{name}", host.name)}
    >
      <GripVertical size={18} aria-hidden />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      className={cn("relative rounded-2xl", isDragging && "z-10 shadow-float ring-2 ring-blue-500")}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
    >
      {props.renderHost(host, handle)}
    </div>
  );
}

export function SortableHostList(props: {
  hosts: Host[];
  language: Language;
  autoSort: boolean;
  onMove: (id: string, targetId: string) => Promise<void>;
  children: (host: Host, dragHandle?: ReactNode) => ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pinnedCount = props.hosts.filter((host) => host.pinned).length;

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || pending) return;
    setPending(true);
    try {
      await props.onMove(String(active.id), String(over.id));
    } finally {
      setPending(false);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestHostInGroup} onDragEnd={onDragEnd}>
      <SortableContext items={props.hosts.map((host) => host.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-3">
          {props.hosts.map((host) => (
            <SortableHost
              key={host.id}
              host={host}
              language={props.language}
              canMove={!props.autoSort && (host.pinned ? pinnedCount : props.hosts.length - pinnedCount) > 1}
              pending={pending}
              renderHost={props.children}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
