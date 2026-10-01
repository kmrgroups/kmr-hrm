"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/app/employees/actions";

/**
 * Wrapper for a server-action form that shows the success / error message and
 * any generated link (with a copy button) under the form.
 *
 * Submits through onSubmit rather than the `action` prop so that React does not
 * clear what the user typed when the server returns an error.
 */
export function ActionForm({
  action, children, submitLabel, pendingLabel, className, confirm, variant, hidden, resetOnSuccess,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  confirm?: string;
  variant?: "secondary" | "danger" | "accent";
  hidden?: Record<string, string>;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [fileError, setFileError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={className ?? "stack"}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        // phone photos are often 4–10 MB: shrink them here, so the upload fits and is quick; refuse other files that are too big
        void (async () => {
          setFileError(null);
          for (const [k, v] of [...data.entries()]) {
            if (!(v instanceof File) || v.size === 0) continue;
            const small = await shrinkImage(v);
            if (small.size > MAX_UPLOAD) { setFileError(`“${v.name}” is ${(v.size / 1048576).toFixed(1)} MB — files must be under 4.5 MB.`); return; }
            if (small !== v) data.set(k, small, v.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg");
          }
          startTransition(() => formAction(data));
        })();
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div><button className={`btn${variant ? " " + variant : ""}`} disabled={pending}>{pending ? pendingLabel ?? "Please wait…" : submitLabel}</button></div>
      {fileError && <div className="alert error" role="alert">{fileError}</div>}
      {state.error && <div className="alert error" role="alert">{state.error}</div>}
      {state.ok && !state.flashed && <div className="alert ok" role="status">{state.ok}</div>}
      {state.link && !state.flashed && <CopyLink link={state.link} />}
    </form>
  );
}

export function CopyLink({ link }: { link: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <small>You can also share this link directly (valid for one person only):</small>
      <div className="copybox">
        <input readOnly value={link} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn secondary small" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
      </div>
    </div>
  );
}

const MAX_UPLOAD = 4.5 * 1024 * 1024;
/** a large photo becomes a JPEG of at most 1800 px on its long side (quality 0.82); anything else is returned as it is */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 1_200_000) return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  return blob ? new File([blob], file.name, { type: "image/jpeg" }) : file;
}
