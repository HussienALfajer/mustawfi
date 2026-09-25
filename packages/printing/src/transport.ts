/** A printer the platform can send raw bytes to. */
export interface PrinterInfo {
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * The platform's byte transport (step 5 of ADR-0025): native code, no layout. On Windows, the
 * spooler in RAW mode; Android and network printers come later.
 */
export interface RawPrinterTransport {
  listPrinters(): Promise<readonly PrinterInfo[]>;
  /** Resolves with the spooler's job id once every byte was handed over. */
  printRaw(printer: string, documentName: string, bytes: Uint8Array): Promise<number>;
}
