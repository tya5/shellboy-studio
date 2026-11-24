import type { OpError } from "../../../data/src";
import { LogBlock } from "../system/components";
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

export function ReadDiagnostic({ t, error, ownerOperationId, log }: { t: Translate; error: OpError; ownerOperationId?: string; log?: boolean }) {
  const code = error.kind === "owner" || error.kind === "bridge" ? error.code : undefined;
  const hint = error.kind === "owner" ? error.hint : undefined;
  const message = t("common.readError", { message: error.message });
  if (log) return <div data-owner-diagnostic=""><LogBlock text={[
    code ? `${t("diagnostic.code")} ${code}` : undefined,
    message,
    hint ? `${t("diagnostic.hint")} ${hint}` : undefined,
    ownerOperationId ? `${t("diagnostic.operation")} ${ownerOperationId}` : undefined,
  ].filter(Boolean).join("\n")} /></div>;
  return <OwnerDiagnostic t={t} message={message} code={code} hint={hint} operationId={ownerOperationId} />;
}
