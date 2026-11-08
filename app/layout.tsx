import type React from "react"
import "./globals.css"
import "streamdown/styles.css"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "FilmPulse",
  description: "Pick your favorite, explore more like it, and find your next movie on the services you watch.",
  generator: 'v0.dev',
  applicationName: "FilmPulse",
  appleWebApp: { capable: true, title: "FilmPulse" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/filmpulse-favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/filmpulse-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="filmpulse-theme">
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
