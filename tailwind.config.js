/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 声场表面
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
        },
        // 文字层级
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)",
          disabled: "rgb(var(--fg-disabled) / <alpha-value>)",
        },
        // 强调色
        mint: {
          DEFAULT: "rgb(var(--mint) / <alpha-value>)",
          strong: "rgb(var(--mint-strong) / <alpha-value>)",
          deep: "rgb(var(--mint-deep) / <alpha-value>)",
        },
        "on-mint": "rgb(var(--on-mint) / <alpha-value>)",
        amber: {
          DEFAULT: "rgb(var(--amber) / <alpha-value>)",
          strong: "rgb(var(--amber-strong) / <alpha-value>)",
          bright: "rgb(var(--amber-bright) / <alpha-value>)",
          soft: "rgb(var(--amber-soft) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          strong: "rgb(var(--danger-strong) / <alpha-value>)",
          soft: "rgb(var(--danger-soft) / <alpha-value>)",
          muted: "rgb(var(--danger-muted) / <alpha-value>)",
          surface: "rgb(var(--danger-surface) / <alpha-value>)",
          on: "rgb(var(--on-danger) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          bright: "rgb(var(--success-bright) / <alpha-value>)",
        },
        // 线条：装饰细线保持低对比；控件边框单独达到 3:1
        line: {
          DEFAULT: "rgb(var(--line-rgb) / 0.08)",
          strong: "rgb(var(--line-rgb) / 0.14)",
          control: "rgb(var(--line-control) / <alpha-value>)",
        },
        overlay: "rgb(var(--overlay) / <alpha-value>)",

        // shadcn/ui 语义名，全部映射到声场 token
        border: "rgb(var(--line-rgb) / 0.14)",
        input: "rgb(var(--line-control) / <alpha-value>)",
        ring: "rgb(var(--mint) / <alpha-value>)",
        background: "rgb(var(--ink-950) / <alpha-value>)",
        foreground: "rgb(var(--fg) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--mint) / <alpha-value>)",
          foreground: "rgb(var(--on-mint) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--ink-800) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          foreground: "rgb(var(--on-danger) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--ink-800) / <alpha-value>)",
          foreground: "rgb(var(--fg-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--ink-700) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--ink-900) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--ink-900) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "rgb(var(--ink-900) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
          primary: "rgb(var(--mint) / <alpha-value>)",
          "primary-foreground": "rgb(var(--on-mint) / <alpha-value>)",
          accent: "rgb(var(--ink-800) / <alpha-value>)",
          "accent-foreground": "rgb(var(--fg) / <alpha-value>)",
          border: "rgb(var(--line-rgb) / 0.08)",
          ring: "rgb(var(--mint) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        hero: ["30px", { lineHeight: "1.15", fontWeight: "650", letterSpacing: "-0.02em" }],
        title: ["20px", { lineHeight: "1.3", fontWeight: "620", letterSpacing: "-0.01em" }],
        body: ["15px", { lineHeight: "1.65", fontWeight: "400" }],
        ui: ["13.5px", { lineHeight: "1.5", fontWeight: "400" }],
        caption: ["12px", { lineHeight: "1.5", fontWeight: "400" }],
        micro: ["11px", { lineHeight: "1.4", fontWeight: "500", letterSpacing: "0.02em" }],
        data: ["10.5px", { lineHeight: "1.4", fontWeight: "500" }],
      },
      spacing: {
        topbar: "var(--topbar-h)",
        dock: "var(--dock-h)",
        "dock-mobile": "var(--dock-h-mobile)",
        channel: "var(--channel-w)",
        "channel-compact": "var(--channel-w-compact)",
        member: "var(--member-w)",
      },
      borderRadius: {
        control: "var(--radius-control)",
        panel: "var(--radius-panel)",
        dialog: "var(--radius-dialog)",
        avatar: "var(--radius-avatar)",
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        panel: "var(--shadow-panel)",
        dialog: "var(--shadow-dialog)",
        rail: "var(--shadow-rail)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        sonar: {
          "0%": { transform: "scale(0.85)", opacity: "0.45" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        eq: {
          "0%,100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        sonar: "sonar var(--duration-sonar) var(--ease-out) infinite",
        eq: "eq 900ms ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
