use pctoolbox_storage::{ConfigStorage, StorageError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DataBits {
    Five,
    Six,
    Seven,
    Eight,
}

impl DataBits {
    pub fn value(self) -> u8 {
        match self {
            DataBits::Five => 5,
            DataBits::Six => 6,
            DataBits::Seven => 7,
            DataBits::Eight => 8,
        }
    }

    pub fn all() -> [DataBits; 4] {
        [DataBits::Five, DataBits::Six, DataBits::Seven, DataBits::Eight]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Parity {
    None,
    Even,
    Odd,
}

impl Parity {
    pub fn all() -> [Parity; 3] {
        [Parity::None, Parity::Even, Parity::Odd]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StopBits {
    One,
    Two,
}

impl StopBits {
    pub fn all() -> [StopBits; 2] {
        [StopBits::One, StopBits::Two]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FlowControl {
    None,
    Hardware,
    Software,
}

impl FlowControl {
    pub fn all() -> [FlowControl; 3] {
        [FlowControl::None, FlowControl::Hardware, FlowControl::Software]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: DataBits,
    pub parity: Parity,
    pub stop_bits: StopBits,
    pub flow_control: FlowControl,
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self {
            port: String::new(),
            baud_rate: 115_200,
            data_bits: DataBits::Eight,
            parity: Parity::None,
            stop_bits: StopBits::One,
            flow_control: FlowControl::None,
        }
    }
}

impl SerialConfig {
    /// 8-N-1 格式的简短描述，用于状态栏显示。
    pub fn format_short(&self) -> String {
        format!(
            "{}-{}-{}",
            self.data_bits.value(),
            match self.parity {
                Parity::None => "N",
                Parity::Even => "E",
                Parity::Odd => "O",
            },
            match self.stop_bits {
                StopBits::One => "1",
                StopBits::Two => "2",
            }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    pub serial: SerialConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            serial: SerialConfig::default(),
        }
    }
}

impl AppConfig {
    /// 配置文件路径：`~/.config/pctoolbox/config.bin`
    pub fn default_path() -> PathBuf {
        pctoolbox_storage::path_utils::config_path("config.bin")
    }

    pub fn load(path: &std::path::Path) -> Result<Self, StorageError> {
        pctoolbox_storage::BincodeStorage::new().load(path)
    }

    /// 加载失败返回默认配置，损坏的配置文件不会导致程序崩溃。
    pub fn load_or_default(path: &std::path::Path) -> Self {
        pctoolbox_storage::load_or_default(path).unwrap_or_else(|e| {
            eprintln!("配置加载失败，使用默认配置: {e}");
            Self::default()
        })
    }

    pub fn save(&self, path: &std::path::Path) -> Result<(), StorageError> {
        pctoolbox_storage::BincodeStorage::new().save(path, self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_short_is_8n1_style() {
        let config = SerialConfig::default();
        assert_eq!(config.format_short(), "8-N-1");
    }

    #[test]
    fn config_roundtrip() {
        let dir = std::env::temp_dir().join("pctoolbox-core-test").join("rt1");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.bin");

        let mut config = AppConfig::default();
        config.serial.port = "COM3".into();
        config.serial.baud_rate = 9600;
        config.save(&path).unwrap();

        let loaded = AppConfig::load(&path).unwrap();
        assert_eq!(loaded.serial.port, "COM3");
        assert_eq!(loaded.serial.baud_rate, 9600);

        // 清理
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_config_falls_back_to_default() {
        let dir = std::env::temp_dir().join("pctoolbox-core-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("corrupt.bin");
        std::fs::write(&path, "not valid bincode data").unwrap();

        let config = AppConfig::load_or_default(&path);
        assert_eq!(config.serial.baud_rate, 115_200);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_port_yields_empty_string() {
        let config = AppConfig::default();
        assert!(config.serial.port.is_empty());
    }

    #[test]
    fn baud_rate_range_valid() {
        let mut config = AppConfig::default();
        config.serial.baud_rate = 300;
        assert_eq!(config.serial.baud_rate, 300);

        config.serial.baud_rate = 4_000_000;
        assert_eq!(config.serial.baud_rate, 4_000_000);
    }
}
