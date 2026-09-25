//! The Win32 spooler calls. The only `unsafe` code of the clients: every block states why its
//! pointers are valid for the call.
#![allow(unsafe_code)]

use std::ptr;

use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, GetLastError};
use windows_sys::Win32::Graphics::Printing::{
    AbortPrinter, ClosePrinter, DOC_INFO_1W, EndDocPrinter, EndPagePrinter, EnumPrintersW,
    GetDefaultPrinterW, OpenPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE,
    PRINTER_INFO_4W, StartDocPrinterW, StartPagePrinter, WritePrinter,
};

use crate::{PrintError, PrinterInfo, RawSink, write_all};

fn spooler_error(call: &'static str) -> PrintError {
    // SAFETY: reads the calling thread's last error; no pointers involved.
    let code = unsafe { GetLastError() };
    PrintError::Spooler { call, code }
}

/// A NUL-terminated UTF-16 copy of `text` (callers have refused interior NULs).
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a NUL-terminated UTF-16 string the spooler returned.
///
/// # Safety
/// `text` is null or points to a NUL-terminated UTF-16 string that outlives the call.
unsafe fn from_wide(text: *const u16) -> String {
    if text.is_null() {
        return String::new();
    }
    let mut length = 0;
    // SAFETY: the caller guarantees a terminating NUL, so every read up to it is in bounds.
    while unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    // SAFETY: `length` units were just read from this string.
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, length) })
}

fn default_printer() -> Option<String> {
    let mut length = 0u32;
    // SAFETY: a null buffer with a valid length pointer asks only for the needed size.
    unsafe { GetDefaultPrinterW(ptr::null_mut(), &mut length) };
    if length == 0 {
        return None; // no default printer
    }
    let mut buffer = vec![0u16; length as usize];
    // SAFETY: `buffer` holds `length` UTF-16 units, as the call was told.
    if unsafe { GetDefaultPrinterW(buffer.as_mut_ptr(), &mut length) } == 0 {
        return None;
    }
    // SAFETY: on success the buffer holds a NUL-terminated name.
    Some(unsafe { from_wide(buffer.as_ptr()) })
}

pub(crate) fn list_printers() -> Result<Vec<PrinterInfo>, PrintError> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    // `u64` storage keeps the returned structures (which hold pointers) aligned.
    let mut storage: Vec<u64> = Vec::new();
    // The list can grow between the size query and the read: retry a few times.
    for _ in 0..4 {
        let size = u32::try_from(storage.len() * 8).unwrap_or(u32::MAX);
        let mut needed = 0u32;
        let mut returned = 0u32;
        let buffer = if storage.is_empty() {
            ptr::null_mut()
        } else {
            storage.as_mut_ptr().cast::<u8>()
        };
        // SAFETY: `buffer` is null with size 0, or `storage` with exactly `size` bytes.
        let ok = unsafe {
            EnumPrintersW(
                flags,
                ptr::null(),
                4,
                buffer,
                size,
                &mut needed,
                &mut returned,
            )
        };
        if ok != 0 {
            if returned == 0 {
                return Ok(Vec::new());
            }
            let default = default_printer();
            // SAFETY: on success the buffer starts with `returned` PRINTER_INFO_4W entries,
            // aligned by the `u64` storage, whose strings live in the same buffer.
            let entries = unsafe {
                std::slice::from_raw_parts(
                    storage.as_ptr().cast::<PRINTER_INFO_4W>(),
                    returned as usize,
                )
            };
            return Ok(entries
                .iter()
                .map(|entry| {
                    // SAFETY: the spooler fills each name as a NUL-terminated string.
                    let name = unsafe { from_wide(entry.pPrinterName) };
                    let is_default = default.as_deref() == Some(name.as_str());
                    PrinterInfo { name, is_default }
                })
                .collect());
        }
        // SAFETY: reads the calling thread's last error.
        if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
            return Err(spooler_error("EnumPrintersW"));
        }
        storage = vec![0u64; (needed as usize).div_ceil(8)];
    }
    Err(spooler_error("EnumPrintersW"))
}

/// An open printer, closed when dropped.
struct OpenPrinter(PRINTER_HANDLE);

impl Drop for OpenPrinter {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful OpenPrinterW and is closed once.
        unsafe { ClosePrinter(self.0) };
    }
}

impl RawSink for OpenPrinter {
    fn write(&mut self, chunk: &[u8]) -> Result<usize, PrintError> {
        let length = u32::try_from(chunk.len()).unwrap_or(u32::MAX);
        let mut written = 0u32;
        // SAFETY: `chunk` is valid for `length` bytes (at most its length), and the handle
        // has a started document.
        let ok = unsafe { WritePrinter(self.0, chunk.as_ptr().cast(), length, &mut written) };
        if ok == 0 {
            return Err(spooler_error("WritePrinter"));
        }
        Ok(written as usize)
    }
}

impl OpenPrinter {
    fn abort(&self, error: PrintError) -> PrintError {
        // SAFETY: the handle is open; aborting deletes the job being spooled.
        unsafe { AbortPrinter(self.0) };
        error
    }
}

pub(crate) fn print_raw(printer: &str, document: &str, bytes: &[u8]) -> Result<u32, PrintError> {
    let name = wide(printer);
    let mut handle = PRINTER_HANDLE {
        Value: ptr::null_mut(),
    };
    // SAFETY: `name` is NUL-terminated and `handle` is a valid out pointer; no defaults.
    if unsafe { OpenPrinterW(name.as_ptr(), &mut handle, ptr::null()) } == 0 {
        return Err(spooler_error("OpenPrinterW"));
    }
    let open = OpenPrinter(handle);

    let mut document_name = wide(document);
    // `RAW`: the driver passes the ESC/POS bytes to the port untouched.
    let mut datatype = wide("RAW");
    let info = DOC_INFO_1W {
        pDocName: document_name.as_mut_ptr(),
        pOutputFile: ptr::null_mut(),
        pDatatype: datatype.as_mut_ptr(),
    };
    // SAFETY: `info` and the strings it points to outlive the call.
    let job = unsafe { StartDocPrinterW(open.0, 1, &info) };
    if job == 0 {
        return Err(spooler_error("StartDocPrinterW"));
    }
    // SAFETY: the handle has a started document.
    if unsafe { StartPagePrinter(open.0) } == 0 {
        let error = spooler_error("StartPagePrinter");
        return Err(open.abort(error));
    }
    let mut sink = open;
    if let Err(error) = write_all(&mut sink, bytes) {
        return Err(sink.abort(error));
    }
    // SAFETY: the handle has a started page.
    if unsafe { EndPagePrinter(sink.0) } == 0 {
        let error = spooler_error("EndPagePrinter");
        return Err(sink.abort(error));
    }
    // SAFETY: the handle has a started document.
    if unsafe { EndDocPrinter(sink.0) } == 0 {
        return Err(spooler_error("EndDocPrinter"));
    }
    Ok(job)
}
