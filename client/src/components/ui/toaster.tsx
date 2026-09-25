import { useLocation } from "wouter"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { isPlaySurface, PLAY_TOAST_VIEWPORT_CLASS } from "@/lib/playToastViewport"

export function Toaster() {
  const { toasts } = useToast()
  const [location] = useLocation()
  const play = isPlaySurface(location)

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props} anchor={play ? "play" : "default"}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport className={play ? PLAY_TOAST_VIEWPORT_CLASS : undefined} />
    </ToastProvider>
  )
}
