import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-stroke bg-card px-3 py-2 text-[14px] text-ink-2",
        "placeholder:text-muted focus:border-progress/60 focus:outline-none focus:ring-2 focus:ring-progress/20",
        "disabled:cursor-not-allowed disabled:bg-band",
        className,
      )}
      {...props}
    />
  );
});

export { Input };
