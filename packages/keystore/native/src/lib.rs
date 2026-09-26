//! The OS secure store of the Windows app (ADR-0022): the device credential and the bearer
//! session token live in Windows Credential Manager, not in the local database file, so a copy
//! of that file carries neither.
//!
//! The Windows shell exposes [`Keystore::handle`] as its `secure_store` command. Only the secrets
//! [`SecretName`] names can be reached: the web view never names an entry itself, so it cannot
//! read another application's credentials.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use keyring_core::{CredentialStore, Entry, Error};
use serde::Deserialize;

/// A secret the app keeps in the store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretName {
    /// The device credential issued at registration, with the device it belongs to.
    DeviceCredential,
    /// The bearer token of the session held on the device.
    SessionToken,
}

impl SecretName {
    /// The entry's user under the app's service; Credential Manager shows the target
    /// `<user>.<service>`.
    fn user(self) -> &'static str {
        match self {
            Self::DeviceCredential => "device-credential",
            Self::SessionToken => "session-token",
        }
    }
}

/// One request of the `secure_store` protocol (`@mustawfi/keystore/tauri`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Request {
    /// The secret, or none when the store holds no such entry.
    Get { name: SecretName },
    /// Creates or replaces the entry.
    Set { name: SecretName, value: String },
    /// Removes the entry; removing a missing one is not an error.
    Delete { name: SecretName },
}

/// The app's entries in one credential store.
pub struct Keystore {
    store: Arc<CredentialStore>,
    service: String,
    modifiers: HashMap<&'static str, &'static str>,
    /// One call at a time: the Windows store does not keep calls on one entry from several
    /// threads in order, and Tauri runs commands on a pool.
    one_at_a_time: Mutex<()>,
}

impl Keystore {
    /// Windows Credential Manager of the signed-in Windows user, under `service` (the app's
    /// identifier). Entries persist on this computer only (`CRED_PERSIST_LOCAL_MACHINE`): a
    /// device credential must never roam with the Windows profile to another computer.
    #[cfg(windows)]
    pub fn windows(service: &str) -> Result<Self, Error> {
        let store: Arc<CredentialStore> = windows_native_keyring_store::Store::new()?;
        Ok(Self::new(
            store,
            service,
            HashMap::from([("persistence", "Local")]),
        ))
    }

    /// The app's entries in `store`, built with the store's `modifiers`.
    pub fn new(
        store: Arc<CredentialStore>,
        service: &str,
        modifiers: HashMap<&'static str, &'static str>,
    ) -> Self {
        Self {
            store,
            service: service.to_owned(),
            modifiers,
            one_at_a_time: Mutex::new(()),
        }
    }

    /// Answers one request: the secret for `get`, nothing for `set` and `delete`.
    pub fn handle(&self, request: Request) -> Result<Option<String>, Error> {
        let _one = self
            .one_at_a_time
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        match request {
            Request::Get { name } => match self.entry(name)?.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(Error::NoEntry) => Ok(None),
                Err(error) => Err(error),
            },
            Request::Set { name, value } => {
                self.entry(name)?.set_password(&value)?;
                Ok(None)
            }
            Request::Delete { name } => match self.entry(name)?.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(None),
                Err(error) => Err(error),
            },
        }
    }

    fn entry(&self, name: SecretName) -> Result<Entry, Error> {
        let modifiers = (!self.modifiers.is_empty()).then_some(&self.modifiers);
        self.store.build(&self.service, name.user(), modifiers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    fn get(name: SecretName) -> Request {
        Request::Get { name }
    }

    fn set(name: SecretName, value: &str) -> Request {
        Request::Set {
            name,
            value: value.to_owned(),
        }
    }

    fn delete(name: SecretName) -> Request {
        Request::Delete { name }
    }

    fn mock_keystore() -> Keystore {
        let store: Arc<CredentialStore> = mock::Store::new().expect("a mock store");
        Keystore::new(store, "mustawfi.test", HashMap::new())
    }

    #[test]
    fn keeps_replaces_and_removes_a_secret() -> Result<(), Error> {
        let keystore = mock_keystore();
        assert_eq!(keystore.handle(get(SecretName::SessionToken))?, None);
        keystore.handle(set(SecretName::SessionToken, "first"))?;
        keystore.handle(set(SecretName::SessionToken, "second"))?;
        assert_eq!(
            keystore.handle(get(SecretName::SessionToken))?,
            Some("second".to_owned())
        );
        keystore.handle(delete(SecretName::SessionToken))?;
        assert_eq!(keystore.handle(get(SecretName::SessionToken))?, None);
        // Removing what is already gone (a wipe after a lock) is not an error.
        keystore.handle(delete(SecretName::SessionToken))?;
        Ok(())
    }

    #[test]
    fn keeps_each_name_in_its_own_entry() -> Result<(), Error> {
        let keystore = mock_keystore();
        keystore.handle(set(SecretName::DeviceCredential, "device"))?;
        keystore.handle(set(SecretName::SessionToken, "session"))?;
        keystore.handle(delete(SecretName::SessionToken))?;
        assert_eq!(
            keystore.handle(get(SecretName::DeviceCredential))?,
            Some("device".to_owned())
        );
        Ok(())
    }

    #[test]
    fn passes_a_failure_of_the_store_on() -> Result<(), Error> {
        let keystore = mock_keystore();
        keystore.handle(set(SecretName::DeviceCredential, "device"))?;
        let entry = keystore.entry(SecretName::DeviceCredential)?;
        let cred: &mock::Cred = entry.as_any().downcast_ref().expect("a mock credential");
        cred.set_error(Error::NoStorageAccess(Box::new(std::io::Error::other(
            "locked",
        ))));
        assert!(matches!(
            keystore.handle(get(SecretName::DeviceCredential)),
            Err(Error::NoStorageAccess(_))
        ));
        Ok(())
    }

    #[test]
    fn reads_the_protocol_and_refuses_any_other_name() {
        let request: Request =
            serde_json::from_str(r#"{"kind":"set","name":"deviceCredential","value":"secret"}"#)
                .expect("a set request");
        assert_eq!(request, set(SecretName::DeviceCredential, "secret"));
        let request: Request =
            serde_json::from_str(r#"{"kind":"get","name":"sessionToken"}"#).expect("a get request");
        assert_eq!(request, get(SecretName::SessionToken));
        // The web view cannot name an entry of its own choosing.
        assert!(serde_json::from_str::<Request>(r#"{"kind":"get","name":"github.com"}"#).is_err());
    }

    /// The real Credential Manager of the Windows user running the tests, under a service of
    /// this run only, removed at the end.
    #[cfg(windows)]
    #[test]
    fn keeps_a_secret_in_credential_manager_on_this_computer_only() -> Result<(), Error> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let service = format!(
            "de.vertexsystem.mustawfi.test-{}-{nanos}",
            std::process::id()
        );
        let keystore = Keystore::windows(&service)?;
        keystore.handle(set(SecretName::DeviceCredential, "مستوفي-credential"))?;
        let read = keystore.handle(get(SecretName::DeviceCredential));
        let attributes = keystore
            .entry(SecretName::DeviceCredential)?
            .get_attributes();
        // A second keystore is a restart of the app: the secret is still there.
        let restarted = Keystore::windows(&service)?.handle(get(SecretName::DeviceCredential));
        keystore.handle(delete(SecretName::DeviceCredential))?;
        assert_eq!(read?, Some("مستوفي-credential".to_owned()));
        assert_eq!(restarted?, Some("مستوفي-credential".to_owned()));
        let attributes = attributes?;
        assert_eq!(attributes["persistence"], "Local");
        assert_eq!(
            attributes["target_name"],
            format!("device-credential.{service}")
        );
        assert_eq!(keystore.handle(get(SecretName::DeviceCredential))?, None);
        Ok(())
    }
}
