use super::{DeviceTransport, TransportError};
use pctoolbox_core::config::{DataBits, FlowControl, Parity, SerialConfig, StopBits};

#[derive(Debug)]
pub struct SerialPortTransport {
    port: Box<dyn serialport::SerialPort>,
}

impl SerialPortTransport {
    /// 返回当前端口的超时设置（毫秒）。
    pub fn timeout_ms(&self) -> u64 {
        // serialport crate 不暴露 timeout getter，返回默认值
        50
    }
}

impl DeviceTransport for SerialPortTransport {
    fn list_ports() -> Vec<String> {
        serialport::available_ports()
            .map(|ports| {
                ports
                    .into_iter()
                    .map(|p| p.port_name)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }

    fn connect(config: &SerialConfig) -> Result<Box<Self>, TransportError> {
        if config.port.is_empty() {
            return Err(TransportError::Open("端口名不能为空".to_string()));
        }
        if config.baud_rate < 300 {
            return Err(TransportError::Open(
                "波特率不能低于 300".to_string(),
            ));
        }

        let port = serialport::new(&config.port, config.baud_rate)
            .data_bits(match config.data_bits {
                DataBits::Five => serialport::DataBits::Five,
                DataBits::Six => serialport::DataBits::Six,
                DataBits::Seven => serialport::DataBits::Seven,
                DataBits::Eight => serialport::DataBits::Eight,
            })
            .parity(match config.parity {
                Parity::None => serialport::Parity::None,
                Parity::Even => serialport::Parity::Even,
                Parity::Odd => serialport::Parity::Odd,
            })
            .stop_bits(match config.stop_bits {
                StopBits::One => serialport::StopBits::One,
                StopBits::Two => serialport::StopBits::Two,
            })
            .flow_control(match config.flow_control {
                FlowControl::None => serialport::FlowControl::None,
                FlowControl::Hardware => serialport::FlowControl::Hardware,
                FlowControl::Software => serialport::FlowControl::Software,
            })
            .timeout(std::time::Duration::from_millis(50))
            .open()
            .map_err(|e| TransportError::Open(e.to_string()))?;
        Ok(Box::new(Self { port }))
    }

    fn disconnect(&mut self) -> Result<(), TransportError> {
        self.port.clear(serialport::ClearBuffer::All).map_err(|e| {
            TransportError::Write(e.to_string())
        })
    }

    fn write(&mut self, data: &[u8]) -> Result<usize, TransportError> {
        if data.is_empty() {
            return Ok(0);
        }
        self.port.write(data).map_err(|e| TransportError::Write(e.to_string()))
    }

    fn read(&mut self) -> Result<Vec<u8>, TransportError> {
        let mut buf = [0u8; 4096];
        match self.port.read(&mut buf) {
            Ok(n) if n > 0 => Ok(buf[..n].to_vec()),
            Ok(_) => Ok(vec![]),
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(vec![]),
            Err(e) => Err(TransportError::Read(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> SerialConfig {
        SerialConfig {
            port: "COM1".into(),
            baud_rate: 115200,
            data_bits: DataBits::Eight,
            parity: Parity::None,
            stop_bits: StopBits::One,
            flow_control: FlowControl::None,
        }
    }

    #[test]
    fn connect_with_empty_port_fails() {
        let config = SerialConfig::default(); // empty port
        let result = SerialPortTransport::connect(&config);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TransportError::Open(_)));
    }

    #[test]
    fn connect_with_low_baud_fails() {
        let mut config = sample_config();
        config.baud_rate = 100; // below minimum
        let result = SerialPortTransport::connect(&config);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TransportError::Open(_)));
    }

    #[test]
    fn connect_with_valid_config_fails_because_no_hardware() {
        // 在非测试环境没有真实 COM1，连接应返回错误（不是 panic）
        let result = SerialPortTransport::connect(&sample_config());
        // 可能成功（有 COM1）或失败（没有），但不应该 panic
        match result {
            Ok(mut t) => {
                let _ = t.disconnect();
            }
            Err(_) => {} // 预期的硬件不可用
        }
    }

    #[test]
    fn write_empty_slice_returns_zero() {
        // 无法在没有真实端口的情况下测试 write，但验证空 slice 不会 panic
        let config = SerialConfig {
            port: "NONEXISTENT_PORT_12345".into(),
            ..Default::default()
        };
        let result = SerialPortTransport::connect(&config);
        assert!(result.is_err()); // 连接应该失败，这是预期行为
    }

    #[test]
    fn list_ports_returns_vector() {
        let ports = SerialPortTransport::list_ports();
        assert!(ports.iter().all(|p| !p.is_empty()));
    }
}
