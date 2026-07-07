"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  AlertTriangle,
  Loader2,
  ImageIcon,
} from "lucide-react";
import { DEPARTMENTS, PRIORITIES, VENUE_NAME } from "@/lib/constants";
import type { DepartmentId, PriorityId } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const SUBMIT_DRAFT_KEY = "facilities-submit-draft";

type SubmitDraft = {
  name: string;
  comment: string;
  department: string;
  priority: PriorityId;
};

function SubmitForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const successFromUrl = searchParams.get("success") === "1";
  const deptParam = searchParams.get("dept") as DepartmentId | null;
  const validDept = DEPARTMENTS.some((d) => d.id === deptParam)
    ? deptParam!
    : "";

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [department, setDepartment] = useState<DepartmentId | "">(validDept);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [priority, setPriority] = useState<PriorityId>("normal");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(successFromUrl);

  const inAppShell =
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("FacilitiesChecklist");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SUBMIT_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as SubmitDraft;
      if (draft.name) setName(draft.name);
      if (draft.comment) setComment(draft.comment);
      if (draft.department && DEPARTMENTS.some((d) => d.id === draft.department)) {
        setDepartment(draft.department as DepartmentId);
      }
      if (draft.priority) setPriority(draft.priority);
      sessionStorage.removeItem(SUBMIT_DRAFT_KEY);
    } catch {
      sessionStorage.removeItem(SUBMIT_DRAFT_KEY);
    }
  }, []);

  function persistDraft() {
    try {
      const draft: SubmitDraft = {
        name,
        comment,
        department,
        priority,
      };
      sessionStorage.setItem(SUBMIT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore quota errors */
    }
  }

  function openCameraPicker() {
    persistDraft();
    cameraRef.current?.click();
  }

  function openLibraryPicker() {
    persistDraft();
    libraryRef.current?.click();
  }

  function onPhotoChange(file: File | null) {
    setPhotoFile(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
    if (file) setError(null);
  }

  const formReady =
    Boolean(department) &&
    name.trim().length > 0 &&
    comment.trim().length >= 3 &&
    photoFile !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!department || !name.trim() || comment.trim().length < 3) return;

    if (!photoFile) {
      setError("A photo is required. Take a photo or choose one from your library.");
      return;
    }

    if (!isSupabaseConfigured()) {
      setError(
        "Unable to connect right now. Please try again later or contact your manager.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const ext = photoFile.name.split(".").pop() ?? "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("issue-photos")
        .upload(path, photoFile, { cacheControl: "3600", upsert: false });

      if (uploadError) {
        throw new Error(`Photo upload failed: ${uploadError.message}`);
      }
      const photo_path = path;

      const { error: insertError } = await supabase.from("issues").insert({
        department,
        comment: comment.trim(),
        submitted_by: name.trim(),
        priority,
        photo_path,
        status: "open",
        workflow_status: "open",
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      sessionStorage.removeItem(SUBMIT_DRAFT_KEY);
      router.replace("/submit?success=1");
      setSubmitted(true);
      setName("");
      setComment("");
      setPriority("normal");
      onPhotoChange(null);
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit issue");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3.5 text-base outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20";

  if (submitted) {
    return (
      <div className="surface-card mx-auto max-w-lg p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 text-2xl text-teal-600">
          ✓
        </div>
        <h2 className="mt-4 text-xl font-bold text-zinc-900">Issue submitted</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Managers will see it on the dashboard immediately.
        </p>
        <Link
          href="/"
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-[#1a73e8] py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#1a73e8]/20 active:scale-[0.98]"
        >
          Back to home
        </Link>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            router.replace("/submit");
          }}
          className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3.5 text-sm font-semibold text-zinc-800 active:bg-zinc-50"
        >
          Submit another
        </button>
        <Link
          href="/login?next=/lead"
          className="mt-3 block text-sm font-medium text-[#1a73e8]"
        >
          Open manager dashboard
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-lg pb-28">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#1a73e8]"
      >
        <ArrowLeft className="h-5 w-5" />
        Back
      </Link>

      <div className="surface-card p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          {VENUE_NAME}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
          Report an issue
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Time is recorded automatically when you submit.
        </p>

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

      <label className="mt-6 block text-sm font-semibold text-zinc-900">
        Your name <span className="text-red-500">*</span>
      </label>
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={fieldClass}
        placeholder="First name or initials"
      />

      <label className="mt-5 block text-sm font-semibold text-zinc-900">
        Location <span className="text-red-500">*</span>
      </label>
      <select
        required
        value={department}
        onChange={(e) => setDepartment(e.target.value as DepartmentId)}
        className={fieldClass}
      >
        <option value="" disabled>
          Select location…
        </option>
        {DEPARTMENTS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>

      <label className="mt-5 block text-sm font-semibold text-zinc-900">
        Priority
      </label>
      <div className="mt-2 flex gap-2">
        {PRIORITIES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPriority(p.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-3.5 text-sm font-semibold transition active:scale-[0.98]",
              priority === p.id
                ? p.id === "urgent"
                  ? "border-red-500 bg-red-50 text-red-800"
                  : "border-[#1a73e8] bg-[#1a73e8]/10 text-[#1a73e8]"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
            )}
          >
            {p.id === "urgent" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : null}
            {p.label}
          </button>
        ))}
      </div>

      <label className="mt-5 block text-sm font-semibold text-zinc-900">
        What&apos;s the issue? <span className="text-red-500">*</span>
      </label>
      <textarea
        required
        minLength={3}
        rows={4}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className={fieldClass}
        placeholder="Describe the problem…"
      />

      <label className="mt-5 block text-sm font-semibold text-zinc-900">
        Photo <span className="text-red-500">*</span>
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        Required — take a photo or choose one from your library.
      </p>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        {...(!inAppShell ? { capture: "environment" as const } : {})}
        className="hidden"
        onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
      />
      {photoPreview ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoPreview}
            alt="Preview"
            className="max-h-48 w-full object-contain bg-zinc-100"
          />
          <button
            type="button"
            onClick={() => {
              onPhotoChange(null);
              if (cameraRef.current) cameraRef.current.value = "";
              if (libraryRef.current) libraryRef.current.value = "";
            }}
            className="w-full border-t border-zinc-200 py-2.5 text-sm font-medium text-red-600"
          >
            Remove photo
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "mt-2 grid grid-cols-2 gap-2 rounded-xl",
            error && !photoFile && "ring-2 ring-red-300 ring-offset-2",
          )}
        >
          <button
            type="button"
            onClick={openCameraPicker}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-zinc-200 bg-white py-6 text-sm font-semibold text-zinc-800 active:bg-zinc-50"
          >
            <Camera className="h-6 w-6 text-[#1a73e8]" />
            Take photo
          </button>
          <button
            type="button"
            onClick={openLibraryPicker}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-zinc-200 bg-white py-6 text-sm font-semibold text-zinc-800 active:bg-zinc-50"
          >
            <ImageIcon className="h-6 w-6 text-[#1a73e8]" />
            Photo library
          </button>
        </div>
      )}
      </div>

      <div className="safe-bottom fixed bottom-0 left-0 right-0 border-t border-zinc-200/80 bg-white/95 p-4 backdrop-blur-md">
        <button
          type="submit"
          disabled={submitting || !formReady}
          className="mx-auto flex w-full max-w-lg items-center justify-center gap-2 rounded-xl bg-[#1a73e8] py-4 text-base font-semibold text-white shadow-lg shadow-[#1a73e8]/25 disabled:opacity-60 active:scale-[0.98]"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Submitting…
            </>
          ) : (
            "Submit issue"
          )}
        </button>
      </div>
    </form>
  );
}

export default function SubmitPage() {
  return (
    <div className="mobile-shell min-h-[100dvh] px-4 py-6">
      <Suspense fallback={<div className="p-8 text-center">Loading…</div>}>
        <SubmitForm />
      </Suspense>
    </div>
  );
}
