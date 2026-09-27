import { useTranslation } from "react-i18next";
import {
  deviceLimitOf,
  type DeviceLimitUse,
  type DevicePlatform,
  type DeviceType,
} from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";

/**
 * A device's type in words with its platform, as the owner reads it (`core-foundation`
 * slice 20): «تطبيق Windows — جهاز بيع رئيسي», «متصفح — جهاز مساعد».
 */
export function useDeviceKind(): (type: DeviceType, platform: DevicePlatform) => string {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (type, platform) =>
    t("device.kind", {
      platform: t(`device.platforms.${platform}`),
      type: t(`device.types.${type}`),
    });
}

/**
 * The license limit a device of `type` counts against, with how much of it is used when known
 * («يُحسب ضمن أجهزة البيع الرئيسية: 1 من 3»).
 */
export function DeviceLimitNote({
  type,
  use,
}: {
  readonly type: DeviceType;
  readonly use?: DeviceLimitUse | undefined;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const limit = deviceLimitOf(type);
  return (
    <span className="text-sm text-text-secondary">
      {use === undefined
        ? t(`device.countsAgainst.${limit}`)
        : t(`device.countsAgainstUse.${limit}`, { used: use.used, allowed: use.allowed })}
    </span>
  );
}
