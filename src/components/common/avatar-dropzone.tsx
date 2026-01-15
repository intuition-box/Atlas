

"use client"

import * as React from "react"

import { apiPost } from "@/lib/api-client"
import { parseApiClientError, parseApiProblem } from "@/lib/api-errors"
import { cn } from "@/lib/utils"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

type SignedUpload = {
  uploadUrl: string
  publicUrl: string
  headers?: Record<string, string>
}

export type AvatarDropzoneProps = {
  value?: string | null
  alt: string
  fallback: string
  disabled?: boolean
  className?: string
  accept?: string
  maxSizeBytes?: number
  /** Called with the final public URL after upload (or null to clear). */
  onChange: (url: string | null) => void
  /** Optional hook for custom signing logic (e.g. different upload types). */
  sign?: (file: File) => Promise<SignedUpload>
  onError?: (message: string) => void
}

function defaultAccept() {
  return "image/*"
}

async function defaultSign(file: File): Promise<SignedUpload> {
  // Best-effort payload: adjust in caller via `sign` prop if your route expects different fields.
  const res = await apiPost<SignedUpload>("/api/upload/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    kind: "avatar",
  })

  if (res.ok) return res.value

  if (res.error && typeof res.error === "object" && "status" in res.error) {
    const parsed = parseApiProblem(res.error)
    throw new Error(parsed.formError || "Couldn’t prepare upload.")
  }

  const parsed = parseApiClientError(res.error)
  throw new Error(parsed.formError || "Couldn’t prepare upload.")
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
  fallback,
  disabled,
  className,
  accept,
  maxSizeBytes = 10 * 1024 * 1024,
  onChange,
  sign,
  onError,
}: AvatarDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const [isDragActive, setIsDragActive] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function reportError(message: string) {
    setError(message)
    onError?.(message)
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

    setIsUploading(true)
    try {
      const signer = sign ?? defaultSign
      const signed = await signer(file)
      await putFile(signed.uploadUrl, file, signed.headers)
      onChange(signed.publicUrl)
    } catch (e) {
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
  }

  function onDragEnter(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }

  function onDragOver(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }

  function onDragLeave(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }

  function onDrop(e: React.DragEvent) {
    if (disabled || isUploading) return
    e.preventDefault()
    e.stopPropagation()
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
        aria-disabled={disabled || isUploading}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "relative inline-block rounded-2xl outline-none",
          (disabled || isUploading) && "opacity-70",
        )}
      >
        <Avatar className="size-16 rounded-2xl">
          <AvatarImage src={value ?? ""} alt={alt} />
          <AvatarFallback className="rounded-2xl">{fallback}</AvatarFallback>
        </Avatar>

        <div
          data-slot="avatar-dropzone-overlay"
          className={cn(
            "pointer-events-none absolute inset-0 grid place-items-center rounded-2xl",
            "bg-background/70 text-xs font-medium text-foreground/80",
            "opacity-0 transition-opacity",
            (isDragActive || isUploading) && "opacity-100",
          )}
        >
          {isUploading ? "Uploading…" : "Drop to replace"}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept ?? defaultAccept()}
          className="sr-only"
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
        <p data-slot="avatar-dropzone-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { AvatarDropzone }