/**
 * The request header that carries a registered device's credential beside a user's session
 * (`core-foundation` rule 22): a session opened on a device is accepted only with it. Sync
 * requests, which act as the device alone, carry the credential as their bearer instead.
 */
export const DEVICE_CREDENTIAL_HEADER = "mustawfi-device";
