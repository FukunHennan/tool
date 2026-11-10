use super::{DeviceTransport, TransportError};
use pctoolbox_core::config::SerialConfig;

/// 内存中的模拟串口：不依赖真实硬件，用于开发和测试。
pub struct MockTransport {
    echo: Vec<u8>,
}

impl MockTransport {
    pub fn new() -> Self {
        Self { echo: vec![] }
    }

    /// 把接收到的数据回显（模拟设备应答）。
    pub fn with_echo(mut self, data: &[u8]) -> Self {
        self.echo = data.to_vec();
        self
    }
}

impl Default for MockTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl DeviceTransport for MockTransport {
    fn list_ports() -> Vec<String> {
        vec!["MOCK:dev".into(), "MOCK:demo".into()]
    }

    fn connect(_config: &SerialConfig) -> Result<Box<Self>, TransportError> {
        Ok(Box::new(Self::new()))
    }

    fn disconnect(&mut self) -> Result<(), TransportError> {
        Ok(())
    }

    fn write(&mut self, data: &[u8]) -> Result<usize, TransportError> {
        Ok(data.len())
    }

    fn read(&mut self) -> Result<Vec<u8>, TransportError> {
        let data = std::mem::take(&mut self.echo);
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_list_ports_returns_virtual_ports() {
        let ports = MockTransport::list_ports();
        assert!(ports.contains(&"MOCK:dev".to_string()));
        assert!(ports.contains(&"MOCK:demo".to_string()));
        assert_eq!(ports.len(), 2);
    }

    #[test]
    fn mock_connect_returns_working_transport() {
        let transport = MockTransport::connect(&SerialConfig::default());
        assert!(transport.is_ok());
        let mut t = transport.unwrap();
        assert!(t.disconnect().is_ok());
    }

    #[test]
    fn mock_write_returns_byte_count() {
        let mut t = MockTransport::new();
        let result = t.write(b"hello");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 5);
    }

    #[test]
    fn mock_read_returns_echo_data() {
        let mut t = MockTransport::new().with_echo(b"response");
        let data = t.read();
        assert!(data.is_ok());
        assert_eq!(data.unwrap(), b"response");
    }

    #[test]
    fn mock_read_returns_empty_after_consume() {
        let mut t = MockTransport::new().with_echo(b"once");
        let first = t.read().unwrap();
        assert_eq!(first, b"once");
        let second = t.read().unwrap();
        assert!(second.is_empty());
    }

    #[test]
    fn mock_disconnect_is_noop() {
        let mut t = MockTransport::new();
        assert!(t.disconnect().is_ok());
        assert!(t.disconnect().is_ok());
    }

    #[test]
    fn mock_multiple_reads_empty() {
        let mut t = MockTransport::new();
        assert!(t.read().unwrap().is_empty());
        assert!(t.read().unwrap().is_empty());
    }
}
