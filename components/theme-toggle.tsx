"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isLight = mounted && resolvedTheme === "light"
  const label = isLight ? "Switch to dark mode" : "Switch to light mode"

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="rounded-full bg-card text-foreground hover:bg-muted"
      aria-label={label}
      title={label}
      disabled={!mounted}
      onClick={() => setTheme(isLight ? "dark" : "light")}
    >
      {isLight ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  )
}
