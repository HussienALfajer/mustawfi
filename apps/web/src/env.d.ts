interface ImportMetaEnv {
  /** The Windows app's API origin, set at build time (`.env.desktop`); unset in the browser. */
  readonly VITE_MUSTAWFI_API_ORIGIN?: string;
  /**
   * The bundle public keys this build trusts, `kid:x,…` — the current key and the next
   * (ADR-0021); `bundle:keygen` prints each entry.
   */
  readonly VITE_BUNDLE_PUBLIC_KEYS?: string;
  /** The license public keys this build trusts, `kid:x,…`, as `license:keygen` prints them. */
  readonly VITE_LICENSE_PUBLIC_KEYS?: string;
}
