import { useState } from "preact/hooks";
import type { DesignContext } from "../../../ui-core/src";
import { Button } from "../system/components/Button";
import { Field } from "../system/components/Field";
import { Notice } from "../system/components/Notice";

export function AuthPrompt({ context }: { context: DesignContext }) {
  const t = context.model.t.value;
  const [token, setToken] = useState("");
  const [rejected, setRejected] = useState(false);
  return (
    <Notice
      tone="wait"
      title={t("auth.title")}
      actions={
        <>
          <Field ariaLabel={t("auth.label")} placeholder={t("auth.label")} type="password" autoComplete="off" value={token} onInput={(e) => setToken(e.currentTarget.value)} />
          <Button
            variant="primary"
            disabled={token.trim() === ""}
            onClick={() => {
              void context.submitToken(token).then((ok) => {
                setRejected(!ok);
                if (ok) setToken("");
              });
            }}
          >
            {t("auth.submit")}
          </Button>
        </>
      }
    >
      {rejected ? t("auth.bad") : t("auth.body")}
    </Notice>
  );
}
