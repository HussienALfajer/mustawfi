fn main() {
    // Declaring the app's commands makes each one need a permission in `capabilities/`.
    let manifest = tauri_build::AppManifest::new().commands(&["local_db", "printers", "print_raw"]);
    if let Err(error) =
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
    {
        panic!("tauri build script failed: {error:#}");
    }
}
