import type { ReactNode } from "react";

import {
  clampThresholdDb,
  dbToPercent,
  rmsToDb,
} from "@/lib/audioLevel";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line py-5 first:pt-1 last:border-b-0">
      <div className="mb-3">
        <h3 className="text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          {title}
        </h3>
        {description && (
          <p className="mt-1 max-w-[60ch] text-[11px] leading-relaxed text-fg-subtle">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function InlineRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-6">
      <span className="text-[13px] font-medium leading-tight text-fg">{label}</span>
      <div className="w-full md:max-w-[340px]">{children}</div>
    </div>
  );
}

export function SettingRow({
  label,
  help,
  testId,
  children,
}: {
  label: ReactNode;
  help?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={`grid gap-2 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 ${
        help ? "md:items-start" : "md:items-center"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-tight text-fg">{label}</div>
        {help && (
          <p className="mt-1 max-w-[60ch] text-[11px] leading-relaxed text-fg-subtle">
            {help}
          </p>
        )}
      </div>
      <div className="min-w-0 w-full md:ml-auto md:max-w-[340px]">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-control border border-line-control bg-ink-950 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={disabled}
          aria-pressed={value === option.value}
          className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint/70 disabled:opacity-40 ${
            value === option.value
              ? "bg-ink-700 text-fg"
              : "text-fg-subtle hover:text-fg-muted"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LevelMeter({
  level,
  thresholdDb,
}: {
  level: number;
  thresholdDb?: number;
}) {
  const levelPct = dbToPercent(rmsToDb(level));
  const thresholdPct =
    thresholdDb == null ? null : dbToPercent(clampThresholdDb(thresholdDb));

  return (
    <div className="relative h-2 overflow-hidden rounded-full border border-line bg-ink-950">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-mint-deep to-mint transition-[width] duration-100"
        style={{ width: `${levelPct}%` }}
      />
      {thresholdPct != null && (
        <div
          className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-amber"
          style={{ left: `${thresholdPct}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
