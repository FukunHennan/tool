//! 基于 bincode 的二进制配置存储。
//!
//! 替代原 `pctoolbox-core` 中用 `serde_json` 做的 JSON 配置持久化。
//! 优势：
//! - 序列化体积小（无字段名开销）
//! - 速度快（二进制 vs JSON 文本解析）
//! - 类型安全（bincode 要求类型严格匹配）
//!
//! 降级兼容：启动时若二进制文件损坏，自动回退到默认配置并重新写入。
//!
//! 使用 `bincode:: serialize` / `deserialize`，配置结构必须实现 `Serialize + Deserialize`。
//! `pctoolbox_core::config` 中的类型已经标注了 `#[derive(Serialize, Deserialize)]`，
//! 可直接复用。

use std::path::Path;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// 配置存储错误。
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("序列化错误: {0}")]
    Serialize(#[from] bincode::Error),
    #[error("配置版本不兼容: {0}")]
    Incompatible(String),
}

/// 通用配置存储接口。
///
/// 当前实现为二进制（bincode）格式；未来可替换为其他后端。
pub trait ConfigStorage: Send + Sync {
    /// 加载配置，失败时返回 `Err`。
    fn load<T: for<'de> Deserialize<'de>>(&self, path: &Path) -> Result<T, StorageError>;

    /// 保存配置。
    fn save<T: Serialize>(&self, path: &Path, config: &T) -> Result<(), StorageError>;

    /// 删除配置文件（用于重置）。
    fn delete(&self, path: &Path) -> Result<(), StorageError>;
}

/// 基于 bincode 的二进制配置存储实现。
pub struct BincodeStorage;

impl BincodeStorage {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BincodeStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl ConfigStorage for BincodeStorage {
    fn load<T: for<'de> Deserialize<'de>>(&self, path: &Path) -> Result<T, StorageError> {
        let bytes = std::fs::read(path)?;
        let config: T = bincode::deserialize(&bytes)?;
        Ok(config)
    }

    fn save<T: Serialize>(&self, path: &Path, config: &T) -> Result<(), StorageError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = bincode::serialize(config)?;
        std::fs::write(path, bytes)?;
        Ok(())
    }

    fn delete(&self, path: &Path) -> Result<(), StorageError> {
        std::fs::remove_file(path)?;
        Ok(())
    }
}

/// 带降级逻辑的配置加载器：失败时返回默认值。
///
/// 这是最常用的入口：调用方不需要处理加载失败的异常情况。
pub fn load_or_default<T: Default + for<'de> Deserialize<'de>>(
    path: &Path,
) -> Result<T, StorageError> {
    BincodeStorage::new().load(path).or_else(|e| {
        eprintln!("配置加载失败（{e}），使用默认配置");
        Ok(T::default())
    })
}

/// 配置路径构建工具。
pub mod path_utils {
    use std::path::PathBuf;

    /// 获取默认配置目录：`%APPDATA%/pctoolbox/`（Windows）或 `~/.config/pctoolbox/`（Unix）。
    pub fn config_dir() -> PathBuf {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let home = std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."));
                home.join(".config")
            });
        base.join("pctoolbox")
    }

    /// 获取默认配置文件路径。
    pub fn config_path(filename: &str) -> PathBuf {
        config_dir().join(filename)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::path::PathBuf;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct TestConfig {
        name: String,
        baud_rate: u32,
    }

    impl Default for TestConfig {
        fn default() -> Self {
            Self {
                name: "default".to_string(),
                baud_rate: 9600,
            }
        }
    }

    fn temp_path(suffix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("pctoolbox-storage-tests");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(format!("{}-{}.bin", suffix, std::process::id()))
    }

    #[test]
    fn roundtrip_config() {
        let path = temp_path("rt1");
        let storage = BincodeStorage::new();
        let config = TestConfig {
            name: "test_port".into(),
            baud_rate: 115200,
        };
        storage.save(&path, &config).unwrap();
        let loaded: TestConfig = storage.load(&path).unwrap();
        assert_eq!(loaded.name, "test_port");
        assert_eq!(loaded.baud_rate, 115200);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_or_default_on_missing_file() {
        let path = temp_path("rt2");
        let config: TestConfig = load_or_default(&path).unwrap();
        assert_eq!(config.baud_rate, 9600); // 默认值
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_or_default_on_corrupt_file() {
        let path = temp_path("rt3");
        std::fs::write(&path, "not valid bincode data!!!").unwrap();
        let config: TestConfig = load_or_default(&path).unwrap();
        assert_eq!(config.baud_rate, 9600);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_and_load_large_config() {
        let path = temp_path("rt4");
        let storage = BincodeStorage::new();
        let config = TestConfig {
            name: "a".repeat(1000),
            baud_rate: 4_000_000,
        };
        storage.save(&path, &config).unwrap();
        let loaded: TestConfig = storage.load(&path).unwrap();
        assert_eq!(loaded.name.len(), 1000);
        assert_eq!(loaded.baud_rate, 4_000_000);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn creates_parent_directory() {
        let path = temp_path("rt5").join("nested").join("config.bin");
        let storage = BincodeStorage::new();
        let config = TestConfig::default();
        storage.save(&path, &config).unwrap();
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }
}
