"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

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
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // Модальное окно Radix ставит body `pointer-events: none`, и
          // сообщения (они вне окна) это наследовали: кнопку «Перейти на
          // «Премиум»» в отказе по местам из окна «Добавить сотрудника»
          // было не нажать. Клик по сообщению закрывает окно как клик
          // снаружи — и срабатывает действие.
          pointerEvents: "auto",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
