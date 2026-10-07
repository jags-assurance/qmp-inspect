import { cn } from "@/lib/cn";

/**
 * Accessible status area for a form's server-action result. The two live regions are rendered on
 * every pass (empty when there is nothing to say) and only their CONTENT changes: screen readers
 * announce text inserted into a live region that already exists, but usually miss a live node that
 * is mounted together with its text — which is what `{state.error && <p role="alert">…</p>}` does.
 *
 *   <FormMessage error={state.error} success={state.message} />
 *
 * Errors use an assertive region (role="alert"), success text a polite one (role="status").
 * `aria-atomic` makes the whole message be read, not only the changed fragment. Give it an `id` and
 * point the field's `aria-describedby` at it when the message is about one input.
 */
export function FormMessage({
  error,
  success,
  id,
  className,
  suffix,
}: {
  error?: string | null;
  success?: string | null;
  id?: string;
  className?: string;
  /** Extra text appended to the error (e.g. "If you keep having trouble, contact your administrator."). */
  suffix?: string;
}) {
  return (
    <div id={id} className={className}>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {error ? (
          <p className={cn("rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger")}>
            {error}
            {suffix ? ` ${suffix}` : ""}
          </p>
        ) : null}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        {success ? (
          <p className={cn("rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success", error && "mt-2")}>
            {success}
          </p>
        ) : null}
      </div>
    </div>
  );
}
