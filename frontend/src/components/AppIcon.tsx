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
  // http(s), root-relative, or a data: image URI all render as an <img>.
  const isUrl = /^(https?:\/\/|\/|data:image\/)/i.test(icon)
  // Anything else is treated as an emoji/short glyph — but only if it's
  // actually short, so a stray long string (e.g. a base64 blob) can never
  // splatter across the page as giant text.
  const isGlyph = !isUrl && icon.length > 0 && [...icon].length <= 4

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
      {isGlyph ? icon : '🔗'}
    </span>
  )
}
