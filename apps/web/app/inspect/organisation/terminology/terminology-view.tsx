import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { loadTermOverrides } from "@/lib/terminology/load";
import { TERM_DEFINITIONS } from "@/lib/terminology/terms";
import { TermForm } from "./term-form";

/**
 * Terminology (Admin only): rename key terms shown across the app. Platform-wide, labels only; the
 * stored values, routes and statuses behind them do not change.
 */
export async function TerminologyView({ embedded }: { embedded?: boolean }) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect?denied=1");

  const overrides = await loadTermOverrides();

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className={embedded ? "text-lg font-semibold text-text-strong" : "text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"}>
          <T>Terminology</T>
        </Heading>
        <PageGuide
          title={tl("Terminology — how this works")}
          points={[
            "Rename the key terms shown across the app, for everyone. Only the wording changes; records, statuses, links and exports keep working exactly as before.",
            "Leave the plural blank to add an s to the singular. Reset to default puts the original wording back.",
            "PDF reports are generated separately and still use the original wording.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Rename the key terms used across the app.</T></p>

      <div className="mt-6 space-y-4">
        {TERM_DEFINITIONS.map((d) => (
          <TermForm
            key={d.key}
            termKey={d.key}
            description={d.description}
            defaults={{ singular: d.singular, plural: d.plural }}
            current={overrides[d.key] ?? null}
          />
        ))}
      </div>
    </div>
  );
}
