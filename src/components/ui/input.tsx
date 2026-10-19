import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-control border border-line-control bg-ink-800 px-3 py-1 text-base text-fg shadow-none outline-none transition-[border-color,box-shadow,background-color] duration-fast placeholder:text-fg-subtle selection:bg-mint selection:text-on-mint disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-ink-800/50 disabled:opacity-60 md:h-9 md:text-ui",
        "focus-visible:border-mint focus-visible:ring-2 focus-visible:ring-mint/25",
        "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg",
        className
      )}
      {...props}
    />
  )
}

export { Input }
