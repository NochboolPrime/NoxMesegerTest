'use client'

import type { Message } from '@/lib/types'
import { format } from 'date-fns'
import Image from 'next/image'
import { FileIcon } from 'lucide-react'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const time = format(new Date(message.created_at), 'HH:mm')
  const isImage = message.media_type?.startsWith('image')

  return (
    <div className={`flex mb-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-2xl px-3 py-2 ${
          isOwn
            ? 'bg-message-outgoing text-foreground rounded-br-md'
            : 'bg-message-incoming text-foreground rounded-bl-md'
        }`}
      >
        {/* Media */}
        {message.media_url && (
          <div className="mb-1">
            {isImage ? (
              <div className="relative overflow-hidden rounded-lg">
                <Image
                  src={message.media_url}
                  alt="Shared image"
                  width={300}
                  height={300}
                  className="max-w-full h-auto rounded-lg object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <a
                href={message.media_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-background/20 p-2 text-sm hover:bg-background/30 transition-colors"
              >
                <FileIcon className="h-5 w-5 text-primary" />
                <span className="truncate">Attached file</span>
              </a>
            )}
          </div>
        )}

        {/* Text + time */}
        {message.content && (
          <div className="flex items-end gap-2">
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
            <span className={`text-[10px] shrink-0 self-end ${isOwn ? 'text-foreground/50' : 'text-muted-foreground'}`}>
              {time}
            </span>
          </div>
        )}

        {/* Time only for media-only messages */}
        {!message.content && (
          <div className="flex justify-end">
            <span className={`text-[10px] ${isOwn ? 'text-foreground/50' : 'text-muted-foreground'}`}>
              {time}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
