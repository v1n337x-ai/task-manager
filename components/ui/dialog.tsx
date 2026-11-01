"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "center" | "right" }
>(function DialogContent({ className, children, side = "center", ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 bg-card shadow-xl focus:outline-none",
          side === "center"
            ? "left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border border-stroke p-6"
            : "right-0 top-0 h-full w-full max-w-md rounded-l-card border-l border-stroke p-6 overflow-y-auto",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-muted hover:bg-band hover:text-ink" aria-label="Close dialog">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 pr-8", className)} {...props} />;
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Title ref={ref} className={cn("font-display text-2xl tracking-wide text-ink", className)} {...props}>
      {children}
    </DialogPrimitive.Title>
  );
});

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn("mt-1 text-[13px] text-muted", className)} {...props} />;
});

/** Modal — centered dialog alias (brief section 45). */
function Modal(props: React.ComponentProps<typeof Dialog>) {
  return <Dialog {...props} />;
}

/** Drawer — slides from the right (brief section 45). */
function Drawer(props: React.ComponentProps<typeof Dialog>) {
  return <Dialog {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, Modal, Drawer };
