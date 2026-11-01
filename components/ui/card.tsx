import * as React from "react";
import { cn } from "@/lib/utils";

/** Card — hairline-bordered white panel, PPT card anatomy. */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("panel shadow-sm", className)}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("px-5 pt-4 pb-2", className)} {...props} />;
});

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(function CardTitle(
  { className, ...props },
  ref,
) {
  return <h3 ref={ref} className={cn("text-[13px] font-semibold uppercase tracking-wide text-ink", className)} {...props} />;
});

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn("text-[13px] text-muted", className)} {...props} />;
  },
);

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("px-5 pb-5", className)} {...props} />;
});

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
