"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";

import { rpcPost } from "@/lib/api-client";
import { parseApiError } from "@/lib/api-errors";
import { validateHandle } from "@/lib/handle";
import { ROUTE, ROUTES } from "@/lib/routes";

type CreateCommunityPayload = {
  name: string;
  handle: string;
  description?: string | null;
  isPublicDirectory: boolean;
  avatarUrl?: string | null;
  applicationsOpen: boolean;
};

type CreateCommunityResult = {
  community?: { id: string; handle: string };
  handle?: string;
};

type FormValues = {
  name: string;
  handle: string;
  description: string;
  isPublicDirectory: boolean;
  avatarUrl: string;
  applicationsOpen: boolean;
};

function withReturnTo(path: string, returnToUrl: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}returnToUrl=${encodeURIComponent(returnToUrl)}`;
}

export default function NewCommunityPage() {
  const router = useRouter();
  const search = useSearchParams();

  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: "",
      handle: "",
      description: "",
      isPublicDirectory: true,
      avatarUrl: "",
      applicationsOpen: true,
    },
    mode: "onSubmit",
  });

  const bannerError = useMemo(() => {
    const q = (search?.get("error") ?? "").trim();
    if (!q) return null;

    // Back-compat for old redirects (kept minimal).
    if (q === "name") return "Name is required.";
    if (q === "handle") return "Handle is invalid.";
    if (q === "handle_taken") return "That handle is taken.";
    if (q === "handle_retired") return "That handle is retired.";
    if (q === "handle_not_available") return "That handle isn’t available yet.";
    return "Something went wrong.";
  }, [search]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const trimmedName = values.name.trim();
    if (trimmedName.length < 2) {
      setError("name", { type: "validate", message: "Name must be at least 2 characters." });
      return;
    }

    const v = validateHandle(values.handle);
    if (!v.ok) {
      setError("handle", {
        type: "validate",
        message: "Handle must be 3–32 chars, a-z / 0-9 / hyphen, and not reserved.",
      });
      return;
    }

    const payload: CreateCommunityPayload = {
      name: trimmedName,
      handle: v.normalized,
      description: values.description.trim() ? values.description.trim() : null,
      isPublicDirectory: !!values.isPublicDirectory,
      avatarUrl: values.avatarUrl.trim() ? values.avatarUrl.trim() : null,
      applicationsOpen: !!values.applicationsOpen,
    };

    try {
      const res = await rpcPost<CreateCommunityResult>("/api/community/create", payload);
      const nextHandle = res.community?.handle ?? res.handle ?? payload.handle;
      router.push(ROUTE.community(nextHandle));
    } catch (err: any) {
      const parsed = await parseApiError(err);

      // If the API says we’re not signed in / not onboarded, bounce to the correct flow.
      const returnTo = ROUTES.communityNew;
      if (parsed.code === 401) {
        router.push(withReturnTo(ROUTES.signIn, returnTo));
        return;
      }
      if (parsed.code === 428) {
        router.push(withReturnTo(ROUTES.onboarding, returnTo));
        return;
      }

      if (parsed.fieldErrors && typeof parsed.fieldErrors === "object") {
        for (const [key, message] of Object.entries(parsed.fieldErrors as Record<string, string>)) {
          if (
            key === "name" ||
            key === "handle" ||
            key === "description" ||
            key === "avatarUrl" ||
            key === "applicationsOpen"
          ) {
            setError(key as keyof FormValues, { type: "server", message });
          }
        }
      }

      setFormError(parsed.formError ?? "Failed to create community.");
    }
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create a community</h1>
        <p className="text-sm opacity-70">Choose a handle for your community. Handles are used in routes and UI.</p>
      </div>

      {bannerError ? (
        <div className="mt-6 rounded-xl border border-border bg-background p-4 text-sm text-destructive">
          {bannerError}
        </div>
      ) : null}

      {formError ? (
        <div className="mt-6 rounded-xl border border-border bg-background p-4 text-sm text-destructive">
          {formError}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            {...register("name", { required: "Name is required." })}
            className="h-10 w-full rounded-xl border border-border bg-transparent px-3 text-sm outline-none"
            placeholder="Orbit Love"
            autoComplete="organization"
          />
          {errors.name?.message ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="handle">
            Handle
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm opacity-60">@</span>
            <input
              id="handle"
              {...register("handle", { required: "Handle is required." })}
              className="h-10 w-full rounded-xl border border-border bg-transparent px-3 text-sm outline-none"
              placeholder="orbit-love"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="text-xs opacity-60">Allowed: a-z, 0-9, hyphen. 3–32 chars.</p>
          {errors.handle?.message ? <p className="text-xs text-destructive">{errors.handle.message}</p> : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="avatarUrl">
            Community icon (optional)
          </label>
          <input
            id="avatarUrl"
            type="url"
            {...register("avatarUrl")}
            className="h-10 w-full rounded-xl border border-border bg-transparent px-3 text-sm outline-none"
            placeholder="https://…"
          />
          <p className="text-xs opacity-60">Paste an image URL. (Upload UI comes later.)</p>
          {errors.avatarUrl?.message ? <p className="text-xs text-destructive">{errors.avatarUrl.message}</p> : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="description">
            Mission / description (optional)
          </label>
          <textarea
            id="description"
            {...register("description")}
            rows={5}
            className="w-full rounded-xl border border-border bg-transparent p-3 text-sm outline-none"
            placeholder="What is this community about?"
          />
          {errors.description?.message ? (
            <p className="text-xs text-destructive">{errors.description.message}</p>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("applicationsOpen")} />
          <span className="opacity-80">Applications open</span>
        </label>
        <p className="text-xs opacity-60 pl-7">If closed, new members can’t apply.</p>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("isPublicDirectory")} />
          <span className="opacity-80">Public directory</span>
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium opacity-90 hover:opacity-100 disabled:opacity-50"
        >
          {isSubmitting ? "Creating…" : "Create"}
        </button>
      </form>
    </div>
  );
}