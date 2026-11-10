//! ESP 芯片检测接口与实现。
//!
//! 后续基于 ESP ROM Bootloader 协议实现只读识别（芯片型号、MAC、晶振、
//! Flash/PSRAM 信息），协议实现参考 esptool-rs，只读不改写。

use pctoolbox_serial::DeviceTransport;

/// 芯片检测结果。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EspInfo {
    pub chip: Option<String>,
    pub mac: Option<String>,
    pub flash_size: Option<String>,
    pub psram_size: Option<String>,
    pub crystal_hz: Option<u32>,
    pub secure_boot_enabled: bool,
}

impl EspInfo {
    /// 返回芯片型号的简短描述。
    pub fn chip_name(&self) -> &str {
        self.chip.as_deref().unwrap_or("Unknown")
    }

    /// 返回 MAC 地址的简短描述。
    pub fn mac_address(&self) -> &str {
        self.mac.as_deref().unwrap_or("N/A")
    }

    /// 返回完整的芯片信息摘要。
    pub fn summary(&self) -> String {
        format!(
            "{} | MAC: {} | Flash: {} | PSRAM: {}",
            self.chip_name(),
            self.mac_address(),
            self.flash_size.as_deref().unwrap_or("N/A"),
            self.psram_size.as_deref().unwrap_or("N/A"),
        )
    }

    /// 判断是否为 ESP32 系列。
    pub fn is_esp32(&self) -> bool {
        matches!(self.chip.as_deref(), Some(c) if c.contains("ESP32"))
    }

    /// 判断是否为 ESP8266。
    pub fn is_esp8266(&self) -> bool {
        matches!(self.chip.as_deref(), Some(c) if c.contains("8266"))
    }

    /// 判断是否为 ESP32-S 系列。
    pub fn is_esp32s(&self) -> bool {
        matches!(self.chip.as_deref(), Some(c) if c.contains("ESP32-S"))
    }

    /// 判断是否为 ESP32-C 系列。
    pub fn is_esp32c(&self) -> bool {
        matches!(self.chip.as_deref(), Some(c) if c.contains("ESP32-C"))
    }
}

/// 检测接口：`pctoolbox-serial` 的传输之上做协议握手。
pub trait EspDetector {
    /// 通过串口 ROM Bootloader 识别芯片。只读操作。
    fn detect<T: DeviceTransport>(&self, transport: &mut T) -> Result<EspInfo, EspError>;
}

#[derive(Debug, thiserror::Error)]
pub enum EspError {
    #[error("ESP 检测未实现")]
    NotImplemented,
    #[error("协议错误: {0}")]
    Protocol(String),
    #[error("通信失败: {0}")]
    Communication(String),
    #[error("超时")]
    Timeout,
}

/// 占位实现：始终返回 NotImplemented。
/// 后续替换为真实的 esptool-rs 协议实现。
pub struct EspDetectorPlaceholder;

impl EspDetector for EspDetectorPlaceholder {
    fn detect<T: DeviceTransport>(&self, _transport: &mut T) -> Result<EspInfo, EspError> {
        Err(EspError::NotImplemented)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_info_has_unknown_chip() {
        let info = EspInfo::default();
        assert_eq!(info.chip_name(), "Unknown");
        assert_eq!(info.mac_address(), "N/A");
    }

    #[test]
    fn summary_with_full_info() {
        let info = EspInfo {
            chip: Some("ESP32-S3".into()),
            mac: Some("AA:BB:CC:DD:EE:FF".into()),
            flash_size: Some("4MB".into()),
            psram_size: Some("8MB".into()),
            crystal_hz: Some(40_000_000),
            secure_boot_enabled: false,
        };
        let summary = info.summary();
        assert!(summary.contains("ESP32-S3"));
        assert!(summary.contains("AA:BB:CC:DD:EE:FF"));
        assert!(summary.contains("4MB"));
        assert!(summary.contains("8MB"));
    }

    #[test]
    fn is_esp32_variants() {
        assert!(EspInfo { chip: Some("ESP32".into()), ..Default::default() }.is_esp32());
        assert!(EspInfo { chip: Some("ESP32-S3".into()), ..Default::default() }.is_esp32());
        assert!(EspInfo { chip: Some("ESP32-C3".into()), ..Default::default() }.is_esp32c());
        assert!(EspInfo { chip: Some("ESP8266".into()), ..Default::default() }.is_esp8266());
        assert!(!EspInfo::default().is_esp32());
    }

    #[test]
    fn placeholder_detect_returns_not_implemented() {
        let detector = EspDetectorPlaceholder;
        let mut transport = pctoolbox_serial::MockTransport::new();
        let result = detector.detect(&mut transport);
        assert!(matches!(result, Err(EspError::NotImplemented)));
    }

    #[test]
    fn timeout_error_display() {
        let err = EspError::Timeout;
        assert_eq!(format!("{}", err), "超时");
    }

    #[test]
    fn protocol_error_contains_message() {
        let err = EspError::Protocol("bad sync".into());
        assert!(format!("{}", err).contains("bad sync"));
    }
}
