import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const _inter = Inter({ subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  title: 'Messenger',
  description: 'Real-time messenger app',
}

export const viewport: Viewport = {
  themeColor: '#1a2332',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased overflow-hidden">{children}</body>
    </html>
  )
}
