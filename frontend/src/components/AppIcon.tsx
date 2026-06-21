import { useState } from 'react'

// Renders a service icon. The `icon` field may be an image URL (CasaOS-style),
// an emoji/short text, or empty (default). Image URLs that fail to load fall
// back to the default glyph.
export function AppIcon({
  icon,
  size = 32,
  className = '',
}: {
  icon: string
  size?: number
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  const isUrl = /^(https?:\/\/|\/)/i.test(icon)

  if (icon && isUrl && !errored) {
    return (
      <img
        src={icon}
        alt=""
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-md object-contain ${className}`}
      />
    )
  }

  // Emoji / short text, or default glyph.
  return (
    <span
      style={{ fontSize: Math.round(size * 0.8), lineHeight: 1, width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
    >
      {icon && !isUrl ? icon : '🔗'}
    </span>
  )
}
