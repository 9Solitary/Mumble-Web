import { useTranslation } from "react-i18next";

import { useShortcutStore } from "@/store/shortcutStore";
import {
  SHORTCUT_ACTIONS,
  detectMac,
  formatShortcut,
} from "@/lib/shortcuts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

export function ShortcutHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const bindings = useShortcutStore((s) => s.bindings);
  const mac = detectMac();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="shortcuts-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription className="text-fg-muted">
            {t("shortcuts.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0">
          {SHORTCUT_ACTIONS.map((action) => (
            <div
              key={action}
              className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0"
            >
              <p className="min-w-0 text-ui font-medium text-fg">
                {t(`shortcuts.actions.${action}`)}
              </p>
              <Kbd className="h-6 shrink-0 bg-ink-800 px-2 text-[11px] text-fg">
                {formatShortcut(bindings[action], mac)}
              </Kbd>
            </div>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-fg-muted">
          {t("shortcuts.note")}
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
