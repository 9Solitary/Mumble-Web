import { toast } from "sonner";

const DURATION = 4000;

// 全局反馈统一出口：文案由调用方传入 t() 结果，方便随语言切换。
export function toastSuccess(message: string) {
  toast.success(message, { duration: DURATION });
}

export function toastError(message: string) {
  toast.error(message, { duration: DURATION });
}

export function toastInfo(message: string) {
  toast.info(message, { duration: DURATION });
}
