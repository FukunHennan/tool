pub mod mock;
pub mod port;

use pctoolbox_core::config::SerialConfig;

pub use mock::MockTransport;
pub use port::SerialPortTransport;

/// 统一传输接口：UI 只依赖这个 trait，不直接持有串口句柄。
pub trait DeviceTransport {
    /// 列出可用的串口端口名。
    fn list_ports() -> Vec<String>;
    /// 打开并配置串口。
    fn connect(config: &SerialConfig) -> Result<Box<Self>, TransportError>;
    /// 关闭串口。
    fn disconnect(&mut self) -> Result<(), TransportError>;
    /// 写数据。
    fn write(&mut self, data: &[u8]) -> Result<usize, TransportError>;
    /// 读一块数据（阻塞，超时返回 Ok(vec![])）。
    fn read(&mut self) -> Result<Vec<u8>, TransportError>;
}

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("串口打开失败: {0}")]
    Open(String),
    #[error("写入失败: {0}")]
    Write(String),
    #[error("读取失败: {0}")]
    Read(String),
    #[error("未连接")]
    NotConnected,
}
