import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, LogOut } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "@/components/UserAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 账户菜单只负责退出登录；设置入口统一放在 VoiceDock（见 2A 决策 B）。
export function AccountMenu() {
  const { t } = useTranslation();
  const { self, disconnect } = useAppStore();
  const [logoutOpen, setLogoutOpen] = useState(false);

  if (!self) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="account-menu-trigger"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-1 text-fg-muted transition-colors duration-fast hover:bg-ink-800 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 md:h-9 md:pr-2"
          >
            <span className="sr-only">{t("userbar.account")}</span>
            <UserAvatar name={self.name} size={30} />
            <span className="hidden max-w-24 truncate text-ui font-medium text-fg sm:inline">
              {self.name}
            </span>
            <span className="sr-only sm:hidden">{self.name}</span>
            <ChevronDown className="hidden size-3.5 text-fg-subtle sm:inline" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="px-2 py-2">
            <span className="block truncate text-ui font-semibold text-fg">{self.name}</span>
            <span className="mt-0.5 block text-data text-fg-subtle">
              {t("userbar.account")}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            data-testid="account-logout"
            onSelect={() => setLogoutOpen(true)}
            className="gap-2 text-ui"
          >
            <LogOut className="size-4" />
            {t("userbar.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("userbar.logout")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.about.logoutConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnect()}
              className="border-0 bg-danger text-danger-on hover:bg-danger-strong"
            >
              {t("userbar.logout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
