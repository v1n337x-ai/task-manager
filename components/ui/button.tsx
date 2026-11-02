import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — severity/accent tokens from the PPT design system.
 * Destructive = accent red; secondary = hairline; primary = ink (like the band).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-[13px] font-semibold transition focus-visible:outline-none disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        primary: "bg-slate text-white hover:bg-slate/90",
        accent: "bg-accent text-white hover:bg-accent/90",
        outline: "border border-stroke bg-card text-ink-2 hover:bg-xlsx-data rounded-none",
        ghost: "text-ink-2 hover:bg-band",
        link: "text-progress underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
