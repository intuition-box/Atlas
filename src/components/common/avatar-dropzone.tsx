"use client"

import * as React from "react"

import { apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { cn } from "@/lib/utils"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { User } from "lucide-react"

type SignedUpload = {
  uploadUrl?: string
  publicUrl: string
  headers?: Record<string, string>
}

export type AvatarDropzoneProps = {
  value?: string | null
  alt: string
  /** Lucide icon rendered inside AvatarFallback when no image is loaded. Defaults to User. */
  fallbackIcon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  disabled?: boolean
  className?: string
  accept?: string
  maxSizeBytes?: number
  /** Upload policy/type understood by the server (keeps this component generic). */
  uploadType?: string
  /** Called with the final public URL after upload (or null to clear). */
  onChange: (url: string | null) => void
  /** Optional hook for custom signing logic (e.g. different upload types). */
  sign?: (file: File) => Promise<SignedUpload>
  /** Upload via API route (proxy) or direct PUT to presigned URL. Defaults to proxy. */
  uploadMode?: "proxy" | "direct"
  /** Optional hook for custom proxy upload logic. */
  upload?: (file: File) => Promise<{ publicUrl: string }>
  onError?: (message: string) => void
}

function defaultAccept() {
  return "image/*"
}

async function defaultSign(file: File, uploadType: string): Promise<SignedUpload> {
  // Best-effort payload: adjust in caller via `sign` prop if your route expects different fields.
  const res = await apiPost<SignedUpload>("/api/upload/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    type: uploadType,
  })

  if (res.ok) return res.value

  const parsed = parseApiError(res.error)
  throw new Error(parsed.formError || "Couldn't prepare upload.")
}

async function defaultUploadViaApi(file: File, uploadType: string): Promise<{ publicUrl: string }> {
  const fd = new FormData()
  fd.set("file", file)
  fd.set("filename", file.name)
  fd.set("contentType", file.type || "application/octet-stream")
  fd.set("size", String(file.size))
  fd.set("type", uploadType)

  const resp = await fetch("/api/upload/sign", {
    method: "POST",
    body: fd,
  })

  let json: unknown = null
  try {
    json = await resp.json()
  } catch {
    // ignore
  }

  // We support multiple response shapes because `/api/upload/sign` can either:
  // 1) proxy-upload the file server-side and return a publicUrl, OR
  // 2) return a presigned uploadUrl that the client must PUT to.
  type ApiResponse = {
    ok?: boolean
    data?: Record<string, unknown>
    error?: unknown
    publicUrl?: string
    url?: string
    public_url?: string
    uploadUrl?: string
    headers?: Record<string, string>
    upload?: {
      publicUrl?: string
      url?: string
      public_url?: string
      uploadUrl?: string
      headers?: Record<string, string>
    }
  }

  const anyJson = (json && typeof json === "object" ? json : null) as ApiResponse | null

  const payload = unwrapUploadPayload(anyJson)
  const { publicUrl, uploadUrl, headers } = extractUploadFields(payload)

  // If the route returned a presigned uploadUrl, we complete the PUT here.
  // If the route already uploaded the file server-side, it should omit uploadUrl.
  if (resp.ok) {
    if (uploadUrl) {
      await putFile(uploadUrl, file, headers)
    }

    if (publicUrl) {
      return { publicUrl }
    }

    throw new Error("Upload completed but public URL is missing.")
  }

  if (anyJson && anyJson.ok === false && anyJson.error) {
    const parsed = parseApiError(anyJson.error)
    throw new Error(parsed.formError || "Couldn't upload.")
  }

  throw new Error("Couldn't upload.")
}

async function putFile(uploadUrl: string, file: File, extraHeaders?: Record<string, string>) {
  const headers: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
    ...(extraHeaders ?? {}),
  }

  const resp = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  })

  if (!resp.ok) {
    throw new Error("Upload failed.")
  }
}

function firstString(...values: unknown[]) {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrapUploadPayload(anyJson: { ok?: boolean; data?: Record<string, unknown> } | null) {
  if (!anyJson) return null
  if (anyJson.ok === true && isRecord(anyJson.data)) return anyJson.data
  return anyJson
}

function extractUploadFields(payload: unknown): {
  publicUrl?: string
  uploadUrl?: string
  headers?: Record<string, string>
} {
  const p = isRecord(payload) ? payload : null
  const u = p && isRecord(p.upload) ? (p.upload as Record<string, unknown>) : null

  const publicUrl = firstString(p?.publicUrl, p?.url, p?.public_url, u?.publicUrl, u?.url, u?.public_url)
  const uploadUrl = firstString(p?.uploadUrl, u?.uploadUrl)

  const headers = (p && isRecord(p.headers) ? (p.headers as Record<string, string>) : undefined) ??
    (u && isRecord(u.headers) ? (u.headers as Record<string, string>) : undefined)

  return { publicUrl, uploadUrl, headers }
}

function pickFirstFile(dt: DataTransfer): File | null {
  if (dt.files && dt.files.length > 0) return dt.files[0] ?? null
  return null
}

function isProbablyImage(file: File) {
  return file.type ? file.type.startsWith("image/") : true
}

function AvatarDropzone({
  value,
  alt,
  fallbackIcon: FallbackIcon = User,
  disabled,
  className,
  accept,
  maxSizeBytes = 10 * 1024 * 1024,
  uploadType = "avatar",
  onChange,
  sign,
  uploadMode = "proxy",
  upload: uploadOverride,
  onError,
}: AvatarDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const dragCounterRef = React.useRef(0)

  const [isDragActive, setIsDragActive] = React.useState(false)
  const [isHovering, setIsHovering] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // Instant local preview via object URL — shown while the remote URL may still be loading/propagating.
  const [localPreview, setLocalPreview] = React.useState<string | null>(null)
  const localPreviewRef = React.useRef<string | null>(null)
  localPreviewRef.current = localPreview

  // Revoke the object URL on unmount.
  React.useEffect(() => {
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current)
    }
  }, [])

  const normalizedSrc = React.useMemo(() => {
    // Prefer the instant local preview when available.
    if (localPreview) return localPreview
    const s = typeof value === "string" ? value.trim() : ""
    return s.length > 0 ? s : undefined
  }, [value, localPreview])

  // Clear error when value changes (successful upload)
  React.useEffect(() => {
    if (normalizedSrc) {
      setError(null)
    }
  }, [normalizedSrc])

  function reportError(message: string) {
    setError(message)
    onError?.(message)
  }

  function clearError() {
    setError(null)
  }

  async function upload(file: File) {
    setError(null)

    if (!isProbablyImage(file)) {
      reportError("Please upload an image.")
      return
    }

    if (file.size > maxSizeBytes) {
      reportError("That file is too large.")
      return
    }

    // Show an instant local preview so the user sees their image right away,
    // regardless of how long the upload or CDN propagation takes.
    const objectUrl = URL.createObjectURL(file)
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return objectUrl
    })

    setIsUploading(true)
    try {
      if (uploadMode === "proxy") {
        const out = uploadOverride
          ? await uploadOverride(file)
          : await defaultUploadViaApi(file, uploadType)
        onChange(out.publicUrl)
        return
      }

      // direct (legacy): sign then PUT to the presigned URL
      const signed = sign ? await sign(file) : await defaultSign(file, uploadType)
      if (!signed.uploadUrl) {
        throw new Error("Upload URL missing.")
      }
      await putFile(signed.uploadUrl, file, signed.headers)
      onChange(signed.publicUrl)
    } catch (e) {
      // Upload failed — remove the preview.
      setLocalPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      reportError(e instanceof Error ? e.message : "Upload failed.")
    } finally {
      setIsUploading(false)
    }
  }

  function openPicker() {
    if (disabled || isUploading) return
    inputRef.current?.click()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled || isUploading) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      openPicker()
    }
    // Allow Escape to clear errors
    if (e.key === "Escape" && error) {
      clearError()
    }
  }

  function onDragEnter(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragActive(true)
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()
  }

  function onDragLeave(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragActive(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current = 0
    setIsDragActive(false)

    const file = pickFirstFile(e.dataTransfer)
    if (!file) return
    void upload(file)
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        data-slot="avatar-dropzone"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Upload ${alt}`}
        aria-disabled={disabled || isUploading}
        aria-busy={isUploading}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onMouseEnter={() => !disabled && !isUploading && setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "relative inline-block rounded-2xl outline-none transition-transform",
          !disabled && !isUploading && "cursor-pointer hover:scale-105",
          (disabled || isUploading) && "opacity-70 cursor-not-allowed",
        )}
      >
        <Avatar className="size-16 rounded-2xl">
          <AvatarImage
            key={normalizedSrc ?? "empty"}
            src={normalizedSrc}
            alt={alt}
            // Some OAuth avatar hosts (e.g. Google) can be finicky with referrers.
            referrerPolicy="no-referrer"
          />
          <AvatarFallback>
            <FallbackIcon />
          </AvatarFallback>
        </Avatar>

        <div
          data-slot="avatar-dropzone-overlay"
          className={cn(
            "pointer-events-none absolute inset-0 grid place-items-center rounded-2xl",
            "bg-background/80 text-xs font-medium text-foreground/90",
            "opacity-0 transition-opacity",
            (isDragActive || isUploading || (isHovering && !disabled)) && "opacity-100",
          )}
        >
          {isUploading ? "Uploading…" : isDragActive ? "Drop to replace" : "Click to change"}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept ?? defaultAccept()}
          className="sr-only"
          aria-label={`Choose ${alt} file`}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null
            // Allow selecting the same file again later.
            e.target.value = ""
            if (!file) return
            void upload(file)
          }}
        />
      </div>

      <p data-slot="avatar-dropzone-hint" className="text-muted-foreground text-xs">
        Drag and drop an image onto the avatar, or click to choose.
      </p>

      {error ? (
        <div className="flex items-start justify-between gap-2">
          <p data-slot="avatar-dropzone-error" className="text-xs text-destructive flex-1">
            {error}
          </p>
          <button
            type="button"
            onClick={clearError}
            className="text-muted-foreground hover:text-foreground text-xs underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  )
}

export { AvatarDropzone }