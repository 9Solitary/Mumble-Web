import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Smartphone, Zap } from "lucide-react";

import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";

function SonarBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-mint/10 md:left-[32%] md:size-[680px]" />
      <div className="absolute left-1/2 top-1/2 size-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-mint/[0.06] md:left-[32%] md:size-[920px]" />
      <div className="absolute left-1/2 top-1/2 size-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-mint/[0.04] md:left-[32%] md:size-[1160px]" />
    </div>
  );
}

function BrandPanel() {
  const { t } = useTranslation();
  const features = [
    {
      icon: <Zap className="size-4" />,
      title: t("connect.featureLowLatency"),
      body: t("connect.featureLowLatencyBody"),
    },
    {
      icon: <Link2 className="size-4" />,
      title: t("connect.featureInvite"),
      body: t("connect.featureInviteBody"),
    },
    {
      icon: <Smartphone className="size-4" />,
      title: t("connect.featureNoInstall"),
      body: t("connect.featureNoInstallBody"),
    },
  ];

  return (
    <section className="hidden min-w-0 lg:block">
      <div className="flex items-center gap-3">
        <BrandMark className="size-11 rounded-[12px]" />
        <div>
          <div className="text-title font-semibold tracking-tight text-fg">Mumble Web</div>
          <div className="text-caption text-fg-subtle">
            {t("connect.brandSubtitle")}
          </div>
        </div>
      </div>
      <h1 className="mt-10 max-w-[13ch] text-hero text-fg">
        {t("connect.heroTitle")}
      </h1>
      <p className="mt-3 max-w-[42ch] text-body text-fg-muted">
        {t("connect.heroBody")}
      </p>

      <ul className="mt-10 space-y-5">
        {features.map((feature) => (
          <li key={feature.title} className="flex gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control border border-line-control bg-ink-900 text-mint">
              {feature.icon}
            </span>
            <div className="min-w-0">
              <div className="text-ui font-medium text-fg">{feature.title}</div>
              <p className="mt-0.5 max-w-[38ch] text-caption text-fg-subtle">
                {feature.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConnectShell({
  children,
  cardTestId,
  className,
}: {
  children: ReactNode;
  cardTestId?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-ink-950 px-4 py-8 text-fg">
      <SonarBackdrop />
      <div className="relative z-10 mx-auto grid w-full max-w-5xl items-center gap-10 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
        <BrandPanel />
        <div className="w-full max-w-[400px] justify-self-center lg:justify-self-end">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <div className="min-w-0">
              <div className="text-title font-semibold tracking-tight text-fg">
                Mumble Web
              </div>
              <div className="truncate text-caption text-fg-subtle">
                {t("connect.brandSubtitle")}
              </div>
            </div>
          </div>
          <div
            data-testid={cardTestId}
            className={cn(
              "w-full rounded-dialog border border-line-strong bg-ink-900 p-5 shadow-dialog sm:p-6",
              className,
            )}
          >
            {children}
          </div>
          <p className="mt-4 text-center text-data text-fg-subtle">
            Mumble Web · {t("connect.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
