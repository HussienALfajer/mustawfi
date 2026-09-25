//! The native printer transport (ADR-0025): layout never happens here. The client renders the
//! receipt and encodes it to ESC/POS bytes; this crate only lists the printers and hands those
//! bytes to the Windows spooler as a `RAW` job, so the driver passes them through unchanged.
//!
//! The Windows shell exposes [`list_printers`] and [`print_raw`] as Tauri commands.

use serde::Serialize;

#[cfg(windows)]
mod winspool;

/// A printer the spooler knows (local or a connection to a shared one).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

/// Why a job did not reach the spooler whole. The message goes back to the client as is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrintError {
    /// Printing through the spooler exists on Windows only.
    Unsupported,
    /// A spooler call failed; `code` is the Win32 error.
    Spooler { call: &'static str, code: u32 },
    /// The spooler accepted fewer bytes than it was given and then stopped taking any.
    Incomplete { written: usize, total: usize },
    /// The request itself is wrong (an empty job, a name with a NUL).
    Invalid(&'static str),
}

impl std::fmt::Display for PrintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported => write!(f, "printing is supported on Windows only"),
            Self::Spooler { call, code } => write!(f, "{call} failed (Win32 error {code})"),
            Self::Incomplete { written, total } => {
                write!(f, "the spooler took {written} of {total} bytes")
            }
            Self::Invalid(reason) => write!(f, "invalid print request: {reason}"),
        }
    }
}

impl std::error::Error for PrintError {}

/// The printers this Windows user can print to, the default one marked.
pub fn list_printers() -> Result<Vec<PrinterInfo>, PrintError> {
    #[cfg(windows)]
    {
        winspool::list_printers()
    }
    #[cfg(not(windows))]
    {
        Err(PrintError::Unsupported)
    }
}

/// Sends `bytes` to `printer` as one `RAW` job named `document`, and returns the spooler's job
/// id. It succeeds only when the spooler took every byte; otherwise the job is aborted, so a
/// half receipt never prints as if it were whole.
pub fn print_raw(printer: &str, document: &str, bytes: &[u8]) -> Result<u32, PrintError> {
    validate(printer, document, bytes)?;
    #[cfg(windows)]
    {
        winspool::print_raw(printer, document, bytes)
    }
    #[cfg(not(windows))]
    {
        Err(PrintError::Unsupported)
    }
}

fn validate(printer: &str, document: &str, bytes: &[u8]) -> Result<(), PrintError> {
    if bytes.is_empty() {
        return Err(PrintError::Invalid("the job has no bytes"));
    }
    if printer.is_empty() {
        return Err(PrintError::Invalid("no printer named"));
    }
    if printer.contains('\0') || document.contains('\0') {
        return Err(PrintError::Invalid("a name contains NUL"));
    }
    Ok(())
}

/// One write to an open spooler job: how many bytes it took. Used by the Windows spooler only.
#[cfg(any(windows, test))]
pub(crate) trait RawSink {
    fn write(&mut self, chunk: &[u8]) -> Result<usize, PrintError>;
}

/// Writes every byte, however the sink splits them. A write that takes nothing ends the job as
/// [`PrintError::Incomplete`] instead of looping forever.
#[cfg(any(windows, test))]
pub(crate) fn write_all(sink: &mut impl RawSink, bytes: &[u8]) -> Result<(), PrintError> {
    let mut written = 0;
    while written < bytes.len() {
        let taken = sink.write(&bytes[written..])?;
        if taken == 0 {
            return Err(PrintError::Incomplete {
                written,
                total: bytes.len(),
            });
        }
        written += taken.min(bytes.len() - written);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Takes at most `step` bytes per write, and nothing once `limit` bytes are in.
    struct FakeSink {
        step: usize,
        limit: usize,
        received: Vec<u8>,
    }

    impl RawSink for FakeSink {
        fn write(&mut self, chunk: &[u8]) -> Result<usize, PrintError> {
            let room = self.limit - self.received.len();
            let taken = chunk.len().min(self.step).min(room);
            self.received.extend_from_slice(&chunk[..taken]);
            Ok(taken)
        }
    }

    #[test]
    fn partial_writes_are_continued_until_every_byte_is_in() {
        let bytes: Vec<u8> = (0..=255).cycle().take(10_000).collect();
        let mut sink = FakeSink {
            step: 777,
            limit: usize::MAX,
            received: Vec::new(),
        };
        assert_eq!(write_all(&mut sink, &bytes), Ok(()));
        assert_eq!(sink.received, bytes);
    }

    #[test]
    fn a_sink_that_stops_taking_bytes_fails_the_job() {
        let bytes = vec![0x1b; 1000];
        let mut sink = FakeSink {
            step: 300,
            limit: 600,
            received: Vec::new(),
        };
        assert_eq!(
            write_all(&mut sink, &bytes),
            Err(PrintError::Incomplete {
                written: 600,
                total: 1000
            })
        );
    }

    #[test]
    fn a_failing_write_fails_the_job() {
        struct Broken;
        impl RawSink for Broken {
            fn write(&mut self, _: &[u8]) -> Result<usize, PrintError> {
                Err(PrintError::Spooler {
                    call: "WritePrinter",
                    code: 5,
                })
            }
        }
        assert!(matches!(
            write_all(&mut Broken, b"x"),
            Err(PrintError::Spooler {
                call: "WritePrinter",
                ..
            })
        ));
    }

    #[test]
    fn empty_jobs_and_bad_names_are_refused_before_the_spooler() {
        assert!(matches!(
            print_raw("POS-80", "receipt", &[]),
            Err(PrintError::Invalid(_))
        ));
        assert!(matches!(
            print_raw("", "receipt", b"x"),
            Err(PrintError::Invalid(_))
        ));
        assert!(matches!(
            print_raw("POS\0-80", "receipt", b"x"),
            Err(PrintError::Invalid(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn listing_printers_works_and_marks_at_most_one_default() {
        let printers = list_printers().expect("the spooler lists printers");
        assert!(printers.iter().filter(|p| p.is_default).count() <= 1);
        assert!(printers.iter().all(|p| !p.name.is_empty()));
    }

    #[cfg(windows)]
    #[test]
    fn an_unknown_printer_is_a_spooler_error() {
        let result = print_raw("mustawfi-no-such-printer-7f3a", "receipt", b"\x1b@");
        assert!(
            matches!(
                result,
                Err(PrintError::Spooler {
                    call: "OpenPrinterW",
                    ..
                })
            ),
            "{result:?}"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn other_platforms_say_printing_is_unsupported() {
        assert_eq!(list_printers(), Err(PrintError::Unsupported));
        assert_eq!(
            print_raw("POS-80", "receipt", b"x"),
            Err(PrintError::Unsupported)
        );
    }
}
