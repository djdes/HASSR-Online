"use client"

import {
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useSiteTheme } from "@/components/theme/site-theme"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useSiteTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // Сверху по центру, а не снизу справа. На телефоне нижний тост
      // выпрыгивает из-под панели браузера и стопки плавающих кнопок —
      // человек нажимает «скопировать промокод» и видит, как сообщение
      // дёргается где-то внизу. Сверху оно рядом с тем, что нажали.
      position="top-center"
      className="toaster group"
      icons={{
        success: <CheckCircle2Icon className="size-[18px] stroke-[2.2]" />,
        info: <InfoIcon className="size-[18px] stroke-[2.2]" />,
        warning: <TriangleAlertIcon className="size-[18px] stroke-[2.2]" />,
        error: <OctagonXIcon className="size-[18px] stroke-[2.2]" />,
        loading: <Loader2Icon className="size-[18px] animate-spin stroke-[2.2]" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "18px",
          "--width": "400px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
