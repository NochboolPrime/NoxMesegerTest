'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Paperclip, Send, X, Loader2 } from 'lucide-react'
import Image from 'next/image'

interface MessageInputProps {
  conversationId: string
  onSend: (content: string, mediaUrl?: string, mediaType?: string) => Promise<void>
}

export function MessageInput({ conversationId, onSend }: MessageInputProps) {
  const [text, setText] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      alert('File size limit is 10MB')
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setPreview({ url: objectUrl, file })
  }

  const removePreview = () => {
    if (preview) {
      URL.revokeObjectURL(preview.url)
      setPreview(null)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const uploadFile = async (file: File): Promise<{ url: string; type: string }> => {
    const supabase = createClient()
    const ext = file.name.split('.').pop()
    const fileName = `${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, file)

    if (error) throw error

    const { data: { publicUrl } } = supabase.storage
      .from('chat-media')
      .getPublicUrl(fileName)

    return { url: publicUrl, type: file.type }
  }

  const handleSend = async () => {
    if (!text.trim() && !preview) return
    setIsSending(true)

    try {
      let mediaUrl: string | undefined
      let mediaType: string | undefined

      if (preview) {
        setIsUploading(true)
        const result = await uploadFile(preview.file)
        mediaUrl = result.url
        mediaType = result.type
        setIsUploading(false)
      }

      await onSend(text.trim(), mediaUrl, mediaType)
      setText('')
      removePreview()
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setIsSending(false)
      setIsUploading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`
  }

  return (
    <div className="border-t border-border p-3">
      {/* File preview */}
      {preview && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            {preview.file.type.startsWith('image') ? (
              <Image
                src={preview.url}
                alt="Preview"
                width={60}
                height={60}
                className="h-15 w-15 rounded-lg object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-15 items-center rounded-lg bg-secondary px-3">
                <span className="text-xs text-foreground truncate max-w-40">
                  {preview.file.name}
                </span>
              </div>
            )}
            <button
              onClick={removePreview}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.zip"
          onChange={handleFileSelect}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
        >
          <Paperclip className="h-5 w-5" />
          <span className="sr-only">Attach file</span>
        </Button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          rows={1}
          className="flex-1 resize-none rounded-xl bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <Button
          size="icon"
          className="h-10 w-10 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={handleSend}
          disabled={isSending || (!text.trim() && !preview)}
        >
          {isSending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
          <span className="sr-only">Send message</span>
        </Button>
      </div>

      {isUploading && (
        <p className="mt-1 text-xs text-muted-foreground">Uploading file...</p>
      )}
    </div>
  )
}
