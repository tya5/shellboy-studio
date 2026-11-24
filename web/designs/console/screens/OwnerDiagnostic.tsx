import type { OpError } from "../../../data/src";
import type { Translate } from "../../../ui-core/src";

export function OwnerDiagnostic({ t, code, message, hint, operationId }: {
  t: Translate; code?: string; message?: string; hint?: string; operationId?: string;
}) {
  return <span data-owner-diagnostic="">
    {code ? <span>{t("diagnostic.code")} <code>{code}</code>{" "}</span> : null}
    {message ? <span>{message}{" "}</span> : null}
    {hint ? <span>{t("diagnostic.hint")} {hint}{" "}</span> : null}
    {operationId ? <span>{t("diagnostic.operation")} <code>{operationId}</code></span> : null}
  </span>;
}

export function ReadDiagnostic({ t, error, ownerOperationId }: { t: Translate; error: OpError; ownerOperationId?: string }) {
  return <OwnerDiagnostic t={t} message={t("common.readError", { message: error.message })}
    code={error.kind === "owner" || error.kind === "bridge" ? error.code : undefined}
    hint={error.kind === "owner" ? error.hint : undefined}
    operationId={ownerOperationId} />;
}
