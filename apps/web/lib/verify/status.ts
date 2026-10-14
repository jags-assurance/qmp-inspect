/** Public verify page: which banner to show for a verify_document() result. */
export type VerifyBanner = "genuine" | "void" | "superseded" | "rejected" | "not_found";

export function verifyBanner(r: { valid?: boolean; status?: string } | null | undefined): VerifyBanner {
  if (r?.status === "rejected") return "rejected"; // valid=false on purpose: never "genuine"
  if (!r?.valid) return "not_found";
  if (r.status === "void") return "void";
  if (r.status === "superseded") return "superseded";
  return "genuine";
}
