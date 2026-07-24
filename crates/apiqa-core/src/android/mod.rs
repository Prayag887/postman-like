use crate::{AdbRunner, DeviceError};
use qrcode::{QrCode, render::svg};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct QrPairingSecret {
    pub id: Uuid,
    pub service_name: String,
    pub password: String,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPairingChallenge {
    pub id: Uuid,
    pub service_name: String,
    pub qr_payload: String,
    pub qr_svg: String,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPairingResult {
    pub endpoint: String,
    pub adb_output: String,
}

pub fn create_qr_pairing() -> Result<(QrPairingChallenge, QrPairingSecret), DeviceError> {
    let id = Uuid::new_v4();
    let compact = id.simple().to_string();
    let service_name = format!("studio-app-tester-{}", &compact[..10]);
    let password = compact[10..26].to_owned();
    let qr_payload = format!("WIFI:T:ADB;S:{service_name};P:{password};;");
    let code = QrCode::new(qr_payload.as_bytes())
        .map_err(|error| DeviceError::Adb(format!("failed to generate pairing QR: {error}")))?;
    let qr_svg = code
        .render::<svg::Color>()
        .min_dimensions(320, 320)
        .dark_color(svg::Color("#08110f"))
        .light_color(svg::Color("#ffffff"))
        .build();
    let expires_at = OffsetDateTime::now_utc() + time::Duration::minutes(2);
    Ok((
        QrPairingChallenge {
            id,
            service_name: service_name.clone(),
            qr_payload,
            qr_svg,
            expires_at,
        },
        QrPairingSecret {
            id,
            service_name,
            password,
            expires_at,
        },
    ))
}

pub fn parse_mdns_pairing_endpoint(output: &str, service_name: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        (fields.first().is_some_and(|name| *name == service_name)
            && fields
                .get(1)
                .is_some_and(|kind| *kind == "_adb-tls-pairing._tcp"))
        .then(|| fields.get(2).map(|endpoint| (*endpoint).to_owned()))
        .flatten()
    })
}

pub fn finish_qr_pairing(
    runner: &dyn AdbRunner,
    secret: &QrPairingSecret,
) -> Result<Option<QrPairingResult>, DeviceError> {
    if OffsetDateTime::now_utc() >= secret.expires_at {
        return Err(DeviceError::Adb("QR pairing request expired".into()));
    }
    let services = runner.run(&["mdns", "services"])?;
    let Some(endpoint) = parse_mdns_pairing_endpoint(&services, &secret.service_name) else {
        return Ok(None);
    };
    let output = runner.run(&["pair", &endpoint, &secret.password])?;
    if !output.to_ascii_lowercase().contains("successfully paired") {
        return Err(DeviceError::Adb(output.trim().to_owned()));
    }
    Ok(Some(QrPairingResult {
        endpoint,
        adb_output: output.trim().to_owned(),
    }))
}

pub fn configure_proxy_command(serial: &str, host: &str, port: u16) -> Vec<String> {
    vec![
        "-s".into(),
        serial.into(),
        "shell".into(),
        "settings".into(),
        "put".into(),
        "global".into(),
        "http_proxy".into(),
        format!("{host}:{port}"),
    ]
}
pub fn clear_proxy_command(serial: &str) -> Vec<String> {
    vec![
        "-s".into(),
        serial.into(),
        "shell".into(),
        "settings".into(),
        "put".into(),
        "global".into(),
        "http_proxy".into(),
        ":0".into(),
    ]
}
pub fn configure_proxy(
    runner: &dyn AdbRunner,
    serial: &str,
    host: &str,
    port: u16,
) -> Result<(), DeviceError> {
    let args = configure_proxy_command(serial, host, port);
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    runner.run(&refs).map(|_| ())
}
pub fn clear_proxy(runner: &dyn AdbRunner, serial: &str) -> Result<(), DeviceError> {
    let args = clear_proxy_command(serial);
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    runner.run(&refs).map(|_| ())
}
pub fn verify_proxy(runner: &dyn AdbRunner, serial: &str) -> Result<String, DeviceError> {
    runner
        .run(&[
            "-s",
            serial,
            "shell",
            "settings",
            "get",
            "global",
            "http_proxy",
        ])
        .map(|value| value.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constructs_proxy_commands_without_shell_interpolation() {
        assert_eq!(
            configure_proxy_command("device", "10.0.2.2", 8080)
                .last()
                .unwrap(),
            "10.0.2.2:8080"
        );
        assert_eq!(clear_proxy_command("device").last().unwrap(), ":0");
    }

    #[test]
    fn generates_android_adb_qr_payload() {
        let (challenge, secret) = create_qr_pairing().unwrap();
        assert!(
            challenge
                .qr_payload
                .starts_with("WIFI:T:ADB;S:studio-app-tester-")
        );
        assert!(challenge.qr_payload.ends_with(";;"));
        assert_eq!(challenge.id, secret.id);
        assert!(challenge.qr_svg.contains("<svg"));
        assert!(!challenge.qr_svg.contains(&secret.password));
    }

    #[test]
    fn parses_only_matching_pairing_service() {
        let output = "List of discovered mdns services\n\
studio-other _adb-tls-pairing._tcp 192.168.1.2:4000\n\
studio-app-tester-123 _adb-tls-pairing._tcp 192.168.1.4:42891\n";
        assert_eq!(
            parse_mdns_pairing_endpoint(output, "studio-app-tester-123").as_deref(),
            Some("192.168.1.4:42891")
        );
    }
}
