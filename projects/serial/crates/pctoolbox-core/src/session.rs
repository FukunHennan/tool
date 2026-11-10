use crate::config::SerialConfig;

/// 连接状态机。
///
/// 规则（对齐 TuiSerial 的配置锁定机制）：
/// - 未连接时配置可修改；
/// - 连接后配置立即锁定，任何修改都被拒绝；
/// - 断开后解锁。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Disconnected,
    Connected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    Connecting,
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug)]
pub struct Session {
    state: SessionState,
    config: SerialConfig,
}

impl Session {
    pub fn new(config: SerialConfig) -> Self {
        Self {
            state: SessionState::Disconnected,
            config,
        }
    }

    pub fn state(&self) -> SessionState {
        self.state
    }

    /// 连接期间配置锁定。
    pub fn is_config_locked(&self) -> bool {
        self.state == SessionState::Connected
    }

    pub fn config(&self) -> &SerialConfig {
        &self.config
    }

    pub fn config_mut(&mut self) -> Result<&mut SerialConfig, SessionError> {
        if self.is_config_locked() {
            return Err(SessionError::ConfigLocked);
        }
        Ok(&mut self.config)
    }

    pub fn apply(&mut self, event: SessionEvent) {
        match event {
            SessionEvent::Connected => self.state = SessionState::Connected,
            SessionEvent::Disconnected | SessionEvent::Error(_) => {
                self.state = SessionState::Disconnected
            }
            SessionEvent::Connecting => {}
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SessionError {
    #[error("配置已锁定，请先断开连接")]
    ConfigLocked,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{DataBits, FlowControl, Parity, StopBits};

    fn config() -> SerialConfig {
        SerialConfig {
            port: "COM3".into(),
            ..Default::default()
        }
    }

    #[test]
    fn config_unlocks_after_disconnect() {
        let mut session = Session::new(config());
        session.apply(SessionEvent::Connected);
        assert!(session.is_config_locked());
        assert!(session.config_mut().is_err());

        session.apply(SessionEvent::Disconnected);
        assert!(!session.is_config_locked());
        assert!(session.config_mut().is_ok());
    }

    #[test]
    fn new_session_is_disconnected() {
        let session = Session::new(config());
        assert_eq!(session.state(), SessionState::Disconnected);
        assert!(!session.is_config_locked());
    }

    #[test]
    fn error_event_unlocks_config() {
        let mut session = Session::new(config());
        session.apply(SessionEvent::Connected);
        assert!(session.is_config_locked());

        session.apply(SessionEvent::Error("timeout".into()));
        assert_eq!(session.state(), SessionState::Disconnected);
        assert!(!session.is_config_locked());
    }

    #[test]
    fn connecting_event_does_not_change_state() {
        let mut session = Session::new(config());
        session.apply(SessionEvent::Connecting);
        assert_eq!(session.state(), SessionState::Disconnected);
    }

    #[test]
    fn config_changes_after_disconnect() {
        let mut session = Session::new(config());
        session.apply(SessionEvent::Connected);
        assert!(session.config_mut().is_err());

        session.apply(SessionEvent::Disconnected);
        let result = session.config_mut();
        assert!(result.is_ok());
        result.unwrap().baud_rate = 9600;
        assert_eq!(session.config().baud_rate, 9600);
    }

    #[test]
    fn config_mut_preserves_other_fields() {
        let mut session = Session::new(SerialConfig {
            port: "COM5".into(),
            baud_rate: 115200,
            data_bits: DataBits::Seven,
            parity: Parity::Even,
            stop_bits: StopBits::Two,
            flow_control: FlowControl::Hardware,
        });
        let config = session.config_mut().unwrap();
        config.baud_rate = 9600;
        // Other fields should be preserved
        assert_eq!(config.port, "COM5");
        assert_eq!(config.data_bits, DataBits::Seven);
        assert_eq!(config.parity, Parity::Even);
    }
}
