import { formatPhone } from "@mustawfi/kernel";
import { useTranslation } from "react-i18next";
import { CopyButton } from "./copy-button.tsx";
import { UI_NAMESPACE } from "./messages.ts";

export interface SupportContactProps {
  /** The support's WhatsApp number, in E.164. */
  readonly whatsapp: string;
}

/**
 * How to reach Vertex support, under a message that needs them (a license limit reached): the
 * WhatsApp number as machine text with a copy button. A number, not a link: the Windows app opens
 * no external links, and a number copied works on any phone.
 */
export function SupportContact({ whatsapp }: SupportContactProps) {
  const { t } = useTranslation(UI_NAMESPACE);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-text">
      <span>{t("support.whatsapp")}</span>
      <bdi dir="ltr" className="font-mono">
        {formatPhone(whatsapp)}
      </bdi>
      <CopyButton value={whatsapp} label={t("support.number")} />
    </p>
  );
}
