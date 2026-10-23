/** The red one-line problem under a single input, for forms that lay out their own labels
 *  (FormField already renders this for the forms that use it). */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-danger">
      {message}
    </p>
  );
}
