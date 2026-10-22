import type { HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

/** Escape page transforms/filters so fixed dialogs always use the window viewport. */
export function ModalOverlay({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return createPortal(
    <div
      {...props}
      data-modal-overlay=""
      className={cn(
        "[&>*]:max-h-[calc(100dvh-3rem)] [&>*]:overflow-y-auto",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
