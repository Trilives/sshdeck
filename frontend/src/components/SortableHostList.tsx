import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { t } from "../i18n";
import { cn } from "../lib/utils";
import type { Host, Language } from "../types";

const closestHostInGroup: CollisionDetection = (args) => closestCenter({
  ...args,
  droppableContainers: args.droppableContainers.filter(
    (item) => item.data.current?.pinned === args.active.data.current?.pinned,
  ),
});

export type RenderHostCard = (header: ReactNode, details: ReactNode) => ReactNode;

const cardClass = "min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-950/70";

function hostPlacement(index: number, detail = false, shared = false): CSSProperties {
  const side = index % 2;
  return {
    "--host-order": Math.floor(index / 2) * 4 + side + (detail ? 2 : 0),
    "--host-column": detail && !shared ? "1 / -1" : side + 1,
  } as CSSProperties;
}

function SortableHost(props: {
  host: Host;
  language: Language;
  canMove: boolean;
  pending: boolean;
  twoColumn: boolean;
  index: number;
  pairedDetails: boolean;
  anchorPrefix?: string;
  renderHost: (host: Host, renderCard: RenderHostCard, dragHandle?: ReactNode) => ReactNode;
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

  return props.renderHost(host, (header, details) => {
    const joined = props.twoColumn && !!details;
    const edge = props.index % 2 === 0 ? "left" : "right";
    return (
      <>
        <div
          id={props.anchorPrefix ? props.anchorPrefix + host.id : undefined}
          ref={setNodeRef}
          className={cn(cardClass, "relative scroll-mt-6", joined && "host-joined-header", isDragging && "z-10 shadow-float ring-2 ring-blue-500")}
          data-join-edge={joined && !props.pairedDetails ? edge : undefined}
          style={{
            ...hostPlacement(props.index),
            transform: CSS.Translate.toString(transform && (props.twoColumn ? transform : { ...transform, x: 0 })),
            transition,
          }}
        >
          {header}
          {!props.twoColumn && details}
        </div>
        {props.twoColumn && details && (
          <section
            className={cn(cardClass, "host-details flex flex-col")}
            data-join-edge={props.pairedDetails ? "both" : edge}
            style={hostPlacement(props.index, true, props.pairedDetails)}
            aria-label={host.name}
          >
            {details}
          </section>
        )}
      </>
    );
  }, handle);
}

export function SortableHostList(props: {
  hosts: Host[];
  language: Language;
  autoSort: boolean;
  twoColumn: boolean;
  expandedIds: Set<string>;
  anchorPrefix?: string;
  onMove: (id: string, targetId: string) => Promise<boolean>;
  children: (host: Host, renderCard: RenderHostCard, dragHandle?: ReactNode) => ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [slots, setSlots] = useState(() => props.hosts.map((host) => host.id));
  const hostsById = new Map(props.hosts.map((host) => [host.id, host]));
  const occupiedIds = new Set(slots);
  const added = props.twoColumn ? props.hosts.filter((host) => !occupiedIds.has(host.id)) : [];
  // Keep each host in its slot until the page unmounts. Only an explicit drag reorders slots here.
  const ids = added.length ? [...slots, ...added.map((host) => host.id)] : slots;
  if (ids !== slots) setSlots(ids);
  const hosts = props.twoColumn ? ids.map((id) => hostsById.get(id)) : props.hosts;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pinnedCount = props.hosts.filter((host) => host.pinned).length;

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || pending) return;
    setPending(true);
    try {
      const from = String(active.id);
      const to = String(over.id);
      if (await props.onMove(from, to) && props.twoColumn) {
        const pin = hostsById.get(from)?.pinned;
        setSlots((current) => {
          const group = current.filter((id) => hostsById.has(id) && hostsById.get(id)?.pinned === pin);
          const moved = arrayMove(group, group.indexOf(from), group.indexOf(to));
          const groupIds = new Set(group);
          let index = 0;
          return current.map((id) => groupIds.has(id) ? moved[index++] : id);
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestHostInGroup} onDragEnd={onDragEnd}>
      <SortableContext items={hosts.flatMap((host) => host ? [host.id] : [])} strategy={props.twoColumn ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className={cn("grid min-w-0 gap-3", props.twoColumn && "host-grid")}>
          {hosts.map((host, index) => {
            const partnerIndex = index % 2 === 0 ? index + 1 : index - 1;
            const partner = props.twoColumn ? hosts[partnerIndex] : undefined;
            if (!host) {
              return partner ? <div key={ids[index]} aria-hidden="true" className="host-slot" style={hostPlacement(index)} /> : null;
            }
            return (
              <SortableHost
                key={host.id}
                host={host}
                language={props.language}
                canMove={!props.autoSort && (host.pinned ? pinnedCount : props.hosts.length - pinnedCount) > 1}
                pending={pending}
                twoColumn={props.twoColumn}
                index={index}
                pairedDetails={!!partner && props.expandedIds.has(partner.id)}
                anchorPrefix={props.anchorPrefix}
                renderHost={props.children}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
