use crate::gateway::{GatewayCompatibility, GatewayProbeStatus};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GatewayOwnership {
    #[default]
    ManagedLocal,
    AttachedExternal,
}

impl GatewayOwnership {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ManagedLocal => "managedLocal",
            Self::AttachedExternal => "attachedExternal",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GatewayIntent {
    pub ownership: GatewayOwnership,
    pub port: u16,
    pub gateway_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoadedGatewayIntent {
    pub intent: GatewayIntent,
    pub persisted: bool,
}

impl GatewayIntent {
    pub fn managed_local(port: u16) -> Self {
        Self {
            ownership: GatewayOwnership::ManagedLocal,
            port,
            gateway_id: None,
        }
    }

    pub fn attached_external(port: u16, gateway_id: String) -> Self {
        Self {
            ownership: GatewayOwnership::AttachedExternal,
            port,
            gateway_id: Some(gateway_id),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryAction {
    RestartManagedSidecar,
    ReconnectExternal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExistingGatewayAction {
    AttachExternal,
    RefuseOwnershipChange,
}

pub fn existing_gateway_action(allow_external_attach: bool) -> ExistingGatewayAction {
    if allow_external_attach {
        ExistingGatewayAction::AttachExternal
    } else {
        ExistingGatewayAction::RefuseOwnershipChange
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SwitchToLocalAction {
    StartManagedSidecar,
    WaitForFreePort,
}

pub fn switch_to_local_action(port_available: bool) -> SwitchToLocalAction {
    if port_available {
        SwitchToLocalAction::StartManagedSidecar
    } else {
        SwitchToLocalAction::WaitForFreePort
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExternalProbeAction {
    Reattach,
    Retry,
    Fail(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WatchdogAction {
    Healthy,
    RestartManagedSidecar,
    ReconnectExternal,
}

pub fn watchdog_action(
    ownership: GatewayOwnership,
    healthy: bool,
    failure_threshold_reached: bool,
) -> WatchdogAction {
    if healthy || !failure_threshold_reached {
        return WatchdogAction::Healthy;
    }
    match ownership {
        GatewayOwnership::ManagedLocal => WatchdogAction::RestartManagedSidecar,
        GatewayOwnership::AttachedExternal => WatchdogAction::ReconnectExternal,
    }
}

pub fn external_probe_action(
    expected_gateway_id: Option<&str>,
    probe: GatewayProbeStatus,
) -> ExternalProbeAction {
    match probe {
        GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Compatible {
            gateway_id: Some(gateway_id),
            ..
        }) if expected_gateway_id == Some(gateway_id.as_str()) => ExternalProbeAction::Reattach,
        GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Compatible { .. }) => {
            ExternalProbeAction::Fail(
                "A different Cybara gateway is responding at the configured external endpoint. Cybara refused to switch gateway identity. Restore the intended gateway or explicitly switch to local mode."
                    .into(),
            )
        }
        GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible { reason, .. }) => {
            ExternalProbeAction::Fail(reason)
        }
        GatewayProbeStatus::NonCybara => ExternalProbeAction::Fail(
            "The configured external gateway endpoint is occupied by a non-Cybara service. Restore the forwarding connection or explicitly switch to a local gateway after freeing the port."
                .into(),
        ),
        GatewayProbeStatus::Available
        | GatewayProbeStatus::Busy
        | GatewayProbeStatus::UnhealthyCybara { .. } => ExternalProbeAction::Retry,
    }
}

pub struct GatewayOwnershipController {
    intent: GatewayIntent,
    reconnect_generation: u64,
    reconnecting: bool,
}

impl GatewayOwnershipController {
    pub fn new(intent: GatewayIntent) -> Self {
        Self {
            intent,
            reconnect_generation: 0,
            reconnecting: false,
        }
    }

    pub fn intent(&self) -> GatewayIntent {
        self.intent.clone()
    }

    pub fn recovery_action(&self) -> RecoveryAction {
        match self.intent.ownership {
            GatewayOwnership::ManagedLocal => RecoveryAction::RestartManagedSidecar,
            GatewayOwnership::AttachedExternal => RecoveryAction::ReconnectExternal,
        }
    }

    pub fn set_intent(&mut self, intent: GatewayIntent) {
        self.intent = intent;
        self.reconnect_generation = self.reconnect_generation.wrapping_add(1);
        self.reconnecting = false;
    }

    pub fn begin_external_reconnect(&mut self) -> Option<u64> {
        if self.intent.ownership != GatewayOwnership::AttachedExternal || self.reconnecting {
            return None;
        }
        self.reconnect_generation = self.reconnect_generation.wrapping_add(1);
        self.reconnecting = true;
        Some(self.reconnect_generation)
    }

    pub fn external_reconnect_is_current(&self, generation: u64) -> bool {
        self.intent.ownership == GatewayOwnership::AttachedExternal
            && self.reconnecting
            && self.reconnect_generation == generation
    }

    pub fn finish_external_reconnect(&mut self, generation: u64) -> bool {
        if !self.external_reconnect_is_current(generation) {
            return false;
        }
        self.reconnecting = false;
        true
    }
}

pub fn load_gateway_intent(path: &Path, default_port: u16) -> Result<LoadedGatewayIntent, String> {
    let backup = path.with_extension("json.backup");
    let source = if path.exists() {
        path
    } else if backup.exists() {
        backup.as_path()
    } else {
        return Ok(LoadedGatewayIntent {
            intent: GatewayIntent::managed_local(default_port),
            persisted: false,
        });
    };
    let bytes = std::fs::read(source).map_err(|error| error.to_string())?;
    let intent: GatewayIntent = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid gateway intent: {error}"))?;
    if intent.port == 0 {
        return Err("Invalid gateway intent: port must be greater than zero".into());
    }
    if intent.ownership == GatewayOwnership::AttachedExternal
        && intent
            .gateway_id
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err("Invalid gateway intent: external gateway identity is missing".into());
    }
    Ok(LoadedGatewayIntent {
        intent,
        persisted: true,
    })
}

pub fn persist_gateway_intent(path: &Path, intent: &GatewayIntent) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Gateway intent path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.backup");
    let bytes = serde_json::to_vec_pretty(intent).map_err(|error| error.to_string())?;
    let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
    std::io::Write::write_all(&mut file, &bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    if path.exists() {
        if backup.exists() {
            std::fs::remove_file(&backup).map_err(|error| error.to_string())?;
        }
        std::fs::rename(path, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, path);
        }
        return Err(error.to_string());
    }
    if backup.exists() {
        std::fs::remove_file(backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ExistingGatewayAction, ExternalProbeAction, GatewayIntent, GatewayOwnership,
        GatewayOwnershipController, RecoveryAction, SwitchToLocalAction, WatchdogAction,
        existing_gateway_action, external_probe_action, load_gateway_intent,
        persist_gateway_intent, switch_to_local_action, watchdog_action,
    };
    use crate::gateway::{GatewayCompatibility, GatewayProbeStatus};

    #[test]
    fn preexisting_gateway_attachment_is_allowed_only_during_initial_discovery() {
        assert_eq!(
            existing_gateway_action(true),
            ExistingGatewayAction::AttachExternal
        );
        assert_eq!(
            existing_gateway_action(false),
            ExistingGatewayAction::RefuseOwnershipChange
        );
    }

    #[test]
    fn watchdog_restarts_only_managed_gateway_failures() {
        assert_eq!(
            watchdog_action(GatewayOwnership::ManagedLocal, false, true),
            WatchdogAction::RestartManagedSidecar
        );
        assert_eq!(
            watchdog_action(GatewayOwnership::AttachedExternal, false, true),
            WatchdogAction::ReconnectExternal
        );
        assert_eq!(
            watchdog_action(GatewayOwnership::AttachedExternal, true, true),
            WatchdogAction::Healthy
        );
        assert_eq!(
            watchdog_action(GatewayOwnership::ManagedLocal, false, false),
            WatchdogAction::Healthy
        );
    }

    #[test]
    fn managed_local_failures_restart_the_owned_sidecar() {
        let controller = GatewayOwnershipController::new(GatewayIntent::managed_local(4269));
        assert_eq!(
            controller.recovery_action(),
            RecoveryAction::RestartManagedSidecar
        );
    }

    #[test]
    fn external_failures_reconnect_without_starting_a_sidecar() {
        let mut controller = GatewayOwnershipController::new(GatewayIntent::attached_external(
            4269,
            "gateway-test".into(),
        ));
        assert_eq!(
            controller.recovery_action(),
            RecoveryAction::ReconnectExternal
        );
        let generation = controller
            .begin_external_reconnect()
            .expect("begin reconnect");
        assert!(controller.external_reconnect_is_current(generation));
        assert_eq!(controller.begin_external_reconnect(), None);
        assert!(controller.finish_external_reconnect(generation));
    }

    #[test]
    fn external_reconnect_retries_when_the_port_becomes_free() {
        assert_eq!(
            external_probe_action(Some("gateway-test"), GatewayProbeStatus::Available),
            ExternalProbeAction::Retry
        );
    }

    #[test]
    fn external_reconnect_accepts_only_the_persisted_gateway_identity() {
        let matching = GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Compatible {
            gateway_version: "1.0.2310".into(),
            exact_match: true,
            gateway_id: Some("gateway-test".into()),
        });
        let replacement = GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Compatible {
            gateway_version: "1.0.2310".into(),
            exact_match: true,
            gateway_id: Some("replacement-gateway".into()),
        });
        assert_eq!(
            external_probe_action(Some("gateway-test"), matching),
            ExternalProbeAction::Reattach
        );
        assert!(matches!(
            external_probe_action(Some("gateway-test"), replacement),
            ExternalProbeAction::Fail(reason) if reason.contains("different Cybara gateway")
        ));
    }

    #[test]
    fn external_reconnect_fails_closed_for_non_cybara_and_incompatible_services() {
        assert!(matches!(
            external_probe_action(Some("gateway-test"), GatewayProbeStatus::NonCybara),
            ExternalProbeAction::Fail(reason) if reason.contains("non-Cybara service")
        ));
        assert_eq!(
            external_probe_action(
                Some("gateway-test"),
                GatewayProbeStatus::CybaraGateway(GatewayCompatibility::Incompatible {
                    gateway_version: Some("2.0.0".into()),
                    reason: "Gateway major version is incompatible.".into(),
                })
            ),
            ExternalProbeAction::Fail("Gateway major version is incompatible.".into())
        );
    }

    #[test]
    fn explicit_switch_to_local_requires_a_free_port() {
        assert_eq!(
            switch_to_local_action(false),
            SwitchToLocalAction::WaitForFreePort
        );
        assert_eq!(
            switch_to_local_action(true),
            SwitchToLocalAction::StartManagedSidecar
        );
    }

    #[test]
    fn explicit_switch_to_local_cancels_external_reconnect() {
        let mut controller = GatewayOwnershipController::new(GatewayIntent::attached_external(
            4269,
            "gateway-test".into(),
        ));
        let generation = controller
            .begin_external_reconnect()
            .expect("begin reconnect");
        controller.set_intent(GatewayIntent::managed_local(4269));
        assert!(!controller.external_reconnect_is_current(generation));
        assert_eq!(
            controller.recovery_action(),
            RecoveryAction::RestartManagedSidecar
        );
    }

    #[test]
    fn external_intent_survives_application_restart() {
        let root =
            std::env::temp_dir().join(format!("cybara-gateway-intent-{}", std::process::id()));
        let path = root.join("gateway-intent.json");
        let intent = GatewayIntent::attached_external(4269, "gateway-test".into());
        persist_gateway_intent(&path, &intent).expect("persist intent");
        let loaded = load_gateway_intent(&path, 4269).expect("load intent");
        assert_eq!(loaded.intent, intent);
        assert!(loaded.persisted);
        assert_eq!(
            GatewayOwnershipController::new(loaded.intent).recovery_action(),
            RecoveryAction::ReconnectExternal
        );
        std::fs::remove_dir_all(root).expect("remove intent fixture");
    }

    #[test]
    fn interrupted_replacement_recovers_the_previous_external_intent() {
        let root = std::env::temp_dir().join(format!(
            "cybara-backed-up-gateway-intent-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create fixture");
        let path = root.join("gateway-intent.json");
        let backup = path.with_extension("json.backup");
        let intent = GatewayIntent::attached_external(4269, "gateway-test".into());
        std::fs::write(
            &backup,
            serde_json::to_vec(&intent).expect("serialize intent"),
        )
        .expect("write backup");
        let loaded = load_gateway_intent(&path, 4269).expect("recover intent");
        assert_eq!(loaded.intent, intent);
        assert!(loaded.persisted);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn invalid_persisted_intent_fails_closed() {
        let root = std::env::temp_dir().join(format!(
            "cybara-invalid-gateway-intent-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create fixture");
        let path = root.join("gateway-intent.json");
        std::fs::write(&path, br#"{"ownership":"attachedExternal","port":0}"#)
            .expect("write fixture");
        assert!(load_gateway_intent(&path, 4269).is_err());
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn external_intent_without_identity_fails_closed() {
        let root = std::env::temp_dir().join(format!(
            "cybara-missing-gateway-identity-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create fixture");
        let path = root.join("gateway-intent.json");
        std::fs::write(
            &path,
            br#"{"ownership":"attachedExternal","port":4269,"gateway_id":null}"#,
        )
        .expect("write fixture");
        assert!(load_gateway_intent(&path, 4269).is_err());
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn missing_intent_defaults_to_managed_local() {
        let path = std::env::temp_dir().join(format!(
            "cybara-missing-gateway-intent-{}",
            std::process::id()
        ));
        let loaded = load_gateway_intent(&path, 4269).expect("default intent");
        assert_eq!(loaded.intent.ownership, GatewayOwnership::ManagedLocal);
        assert!(!loaded.persisted);
    }
}
