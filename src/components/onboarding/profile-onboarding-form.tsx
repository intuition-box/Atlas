"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

type Initial = {
  name: string;
  handle: string;
  avatarUrl: string;
  headline: string;
  bio: string;
  location: string;
  links: string[];
  skills: string[];
  tags: string[];
};

type FormValues = Initial;

async function signUpload(contentType: string) {
  const res = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "USER_AVATAR",
      contentType,
    }),
  });

  if (!res.ok) throw new Error("Failed to sign upload");
  return (await res.json()) as {
    ok: boolean;
    uploadUrl: string;
    publicUrl: string;
    key: string;
  };
}

async function uploadToSignedUrl(uploadUrl: string, file: File) {
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error("Upload failed");
}

export default function ProfileOnboardingForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [avatarUrl, setAvatarUrl] = React.useState(initial.avatarUrl);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      ...initial,
      avatarUrl: initial.avatarUrl,
      links: initial.links.length ? initial.links : [""],
      skills: initial.skills,
      tags: initial.tags,
    },
    mode: "onSubmit",
  });

  async function onPickAvatar(file: File) {
    setError(null);
    const signed = await signUpload(file.type);
    await uploadToSignedUrl(signed.uploadUrl, file);
    setAvatarUrl(signed.publicUrl);
    form.setValue("avatarUrl", signed.publicUrl, { shouldDirty: true });
  }

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/profile/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          avatarUrl,
          links: (values.links ?? []).map((x) => x.trim()).filter(Boolean),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error ?? "Failed to save");
      }

      router.replace("/");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const values = form.watch();

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-border bg-background p-3 text-sm text-foreground">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-xl border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : null}
        </div>

        <label className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted">
          Upload avatar
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickAvatar(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      <div className="grid gap-3">
        <label className="text-sm text-foreground/70">Name</label>
        <input
          {...form.register("name", { required: true })}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-foreground/50"
          placeholder="Your name"
        />

        <label className="mt-2 text-sm text-foreground/70">Handle</label>
        <input
          {...form.register("handle", { required: true })}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-foreground/50"
          placeholder="your-handle"
        />
        <p className="text-xs text-foreground/60">
          This becomes your public URL. Keep it simple.
        </p>

        <label className="mt-2 text-sm text-foreground/70">Headline</label>
        <input
          {...form.register("headline")}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-foreground/50"
          placeholder="Developer, designer, community builder…"
        />

        <label className="mt-2 text-sm text-foreground/70">Bio</label>
        <textarea
          {...form.register("bio")}
          className="min-h-[96px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground/50"
          placeholder="A few sentences about you…"
        />

        <label className="mt-2 text-sm text-foreground/70">Location</label>
        <input
          {...form.register("location")}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-foreground/50"
          placeholder="Lisbon, PT"
        />

        <label className="mt-2 text-sm text-foreground/70">Links</label>
        <div className="space-y-2">
          {(values.links ?? [""]).map((_, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                {...form.register(`links.${idx}` as const)}
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-foreground/50"
                placeholder="https://…"
              />
              <button
                type="button"
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground/80 hover:bg-muted"
                onClick={() => {
                  const next = [...(form.getValues("links") ?? [])];
                  next.splice(idx, 1);
                  form.setValue("links", next.length ? next : [""], { shouldDirty: true });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground/80 hover:bg-muted"
            onClick={() => {
              const next = [...(form.getValues("links") ?? [])];
              next.push("");
              form.setValue("links", next, { shouldDirty: true });
            }}
          >
            Add link
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
      >
        {saving ? "Saving…" : "Finish setup"}
      </button>
    </form>
  );
}