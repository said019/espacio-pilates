import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const isError = variant === "destructive";
        return (
          <Toast key={id} variant={variant} {...props}>
            {/* Left accent stripe */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl"
              style={{
                background: isError
                  ? "linear-gradient(180deg, #C9A96E 0%, #a07a10 100%)"
                  : "linear-gradient(180deg, #A48550 0%, #7a6038 100%)",
              }}
            />
            {/* Icon */}
            <div
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ml-2"
              style={{
                background: isError ? "rgba(201,162,39,0.15)" : "rgba(164,133,80,0.15)",
                color: isError ? "#C9A96E" : "#A48550",
              }}
            >
              {isError ? "⚠" : "✓"}
            </div>
            <div className="grid gap-0.5 flex-1 min-w-0">
              {title && (
                <ToastTitle
                  className="text-[13px] font-semibold leading-tight"
                  style={{ color: isError ? "#C9A96E" : "#fff" }}
                >
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription className="text-[12px] text-white/50 leading-snug">
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
