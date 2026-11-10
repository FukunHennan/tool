//! 类型安全的**事件总线**（event bus）。
//!
//! 替代 `app.rs` 中散落的 `std::sync::mpsc` channel 模式，
//! 将「后台线程 → UI」和「UI → 后台」的事件流统一抽象为 TypedEvent。
//!
//! ## 设计
//!
//! - `EventBus<E>` 持有多个订阅者（FnMut(&E)），支持按事件类型订阅/取消。
//! - 事件类型 `E` 需实现 `TypedEvent`（Send + Sync + Any + Debug）。
//! - `emit()` 将事件广播给所有匹配的订阅者。
//! - `subscribe()` 返回 `SubscriptionId`，可用于精准移除。
//!
//! ## 使用示例
//!
//! ```ignore
//! let mut bus = EventBus::new();
//! let data = Arc::new(Mutex::new(Vec::new()));
//! let cloned = data.clone();
//! bus.subscribe(move |event: &MyEvent| {
//!     data.lock().unwrap().push(event.clone());
//! });
//! bus.emit(&MyEvent::Connect);
//! ```

use std::collections::HashMap;
use std::fmt;
use thiserror::Error;

/// 事件总线错误。
#[derive(Debug, Error)]
pub enum EventBusError {
    #[error("订阅 ID 不存在")]
    NoSuchSubscription,
}

/// 订阅句柄，用于取消订阅。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SubscriptionId(u64);

impl fmt::Display for SubscriptionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Sub#{}", self.0)
    }
}

/// 所有可通过 EventBus 分发的事件必须实现此 trait。
/// 由 blanket impl 自动覆盖所有 Send + Sync + Any + Debug 类型。
pub trait TypedEvent: Send + Sync + std::any::Any + fmt::Debug + 'static {}
impl<T: Send + Sync + std::any::Any + fmt::Debug + 'static> TypedEvent for T {}

/// 事件分发器：接收 TypedEvent，广播给所有订阅了该类型的 handler。
pub struct EventBus<E: TypedEvent> {
    /// subscription_id -> Box<dyn FnMut(&E)>
    subscribers: HashMap<SubscriptionId, Box<dyn FnMut(&E)>>,
    next_id: u64,
}

impl<E: TypedEvent> EventBus<E> {
    /// 创建空的事件总线。
    pub fn new() -> Self {
        Self {
            subscribers: HashMap::new(),
            next_id: 0,
        }
    }

    /// 订阅事件，返回 SubscriptionId 用于取消订阅。
    ///
    /// handler 在每次 [`EventBus::emit`] 被调用时执行。
    pub fn subscribe(&mut self, handler: impl FnMut(&E) + 'static) -> SubscriptionId {
        let id = SubscriptionId(self.next_id);
        self.next_id += 1;
        self.subscribers.insert(id, Box::new(handler));
        id
    }

    /// 取消订阅。
    pub fn unsubscribe(&mut self, id: SubscriptionId) -> Result<(), EventBusError> {
        if self.subscribers.remove(&id).is_some() {
            Ok(())
        } else {
            Err(EventBusError::NoSuchSubscription)
        }
    }

    /// 广播事件给所有订阅者。
    pub fn emit(&mut self, event: &E) {
        let ids: Vec<SubscriptionId> = self.subscribers.keys().cloned().collect();
        for id in ids {
            if let Some(handler) = self.subscribers.get_mut(&id) {
                handler(event);
            }
        }
    }

    /// 返回当前订阅者数量。
    pub fn subscriber_count(&self) -> usize {
        self.subscribers.len()
    }

    /// 清空所有订阅者。
    pub fn clear(&mut self) {
        self.subscribers.clear();
    }
}

impl<E: TypedEvent> Default for EventBus<E> {
    fn default() -> Self {
        Self::new()
    }
}

// ===== 具体事件类型定义 =====

/// 数据方向（RX/TX）。
/// 从 pctoolbox_core 导入，这里重新导出以保持事件类型的自包含性。
pub use pctoolbox_core::Direction;

/// 串口后台线程 → UI 的事件。
/// 替换原 app.rs 中的 `SerialEvent` enum。
#[derive(Debug, Clone)]
pub enum SerialEvent {
    /// 收到数据（RX）或发送数据（TX）。
    Data(Direction, Vec<u8>),
    /// 连接断开（携带错误信息）。
    Disconnected(String),
}

/// UI → 后台线程的命令（反向通道）。
/// 目前主要用于 shutdown 信号，可扩展为更多命令。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiCommand {
    /// 请求关闭后台线程。
    Shutdown,
}

/// 配置变更事件（用于响应式 UI 刷新）。
#[derive(Debug, Clone)]
pub struct ConfigChanged {
    pub field: ConfigField,
}

/// 配置字段标识。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigField {
    Port,
    BaudRate,
    DataBits,
    Parity,
    StopBits,
    FlowControl,
}

impl ConfigChanged {
    pub fn new(field: ConfigField) -> Self {
        Self { field }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn subscribe_and_emit() {
        let mut bus: EventBus<String> = EventBus::new();
        let received = Arc::new(Mutex::new(Vec::new()));
        let cloned = received.clone();

        bus.subscribe(move |s: &String| {
            cloned.lock().unwrap().push(s.clone());
        });

        bus.emit(&"hello".to_string());
        bus.emit(&"world".to_string());

        let result = received.lock().unwrap();
        assert_eq!(result.as_slice(), &["hello".to_string(), "world".to_string()]);
    }

    #[test]
    fn unsubscribe_removes_handler() {
        let mut bus: EventBus<i32> = EventBus::new();
        let received = Arc::new(Mutex::new(Vec::new()));
        let sub = bus.subscribe({
            let received = received.clone();
            move |n: &i32| {
                received.lock().unwrap().push(*n);
            }
        });

        bus.emit(&42);
        assert_eq!(*received.lock().unwrap(), vec![42]);

        bus.unsubscribe(sub).unwrap();
        bus.emit(&99);
        // 订阅已移除，不应收到 99
        assert_eq!(*received.lock().unwrap(), vec![42]);
    }

    #[test]
    fn multiple_subscribers_all_fire() {
        let mut bus: EventBus<usize> = EventBus::new();
        let results_a = Arc::new(Mutex::new(Vec::new()));
        let results_b = Arc::new(Mutex::new(Vec::new()));
        let cloned_a = results_a.clone();
        let cloned_b = results_b.clone();

        bus.subscribe(move |n: &usize| cloned_a.lock().unwrap().push(*n));
        bus.subscribe(move |n: &usize| cloned_b.lock().unwrap().push(*n * 2));

        bus.emit(&5);
        bus.emit(&10);

        assert_eq!(*results_a.lock().unwrap(), vec![5, 10]);
        assert_eq!(*results_b.lock().unwrap(), vec![10, 20]);
    }

    #[test]
    fn unsubscribe_nonexistent_returns_error() {
        let mut bus: EventBus<()> = EventBus::new();
        assert!(bus.unsubscribe(SubscriptionId(999)).is_err());
    }

    #[test]
    fn clear_removes_all() {
        let mut bus: EventBus<&str> = EventBus::new();
        bus.subscribe(|_: &&str| {});
        bus.subscribe(|_: &&str| {});
        assert_eq!(bus.subscriber_count(), 2);
        bus.clear();
        assert_eq!(bus.subscriber_count(), 0);
    }

    #[test]
    fn serial_event_fires_correctly() {
        let mut bus: EventBus<SerialEvent> = EventBus::new();
        let received = Arc::new(Mutex::new(Vec::new()));
        let cloned = received.clone();

        bus.subscribe(move |event: &SerialEvent| {
            cloned.lock().unwrap().push(format!("{:?}", event));
        });

        bus.emit(&SerialEvent::Data(Direction::Rx, vec![1, 2, 3]));
        bus.emit(&SerialEvent::Disconnected("timeout".into()));

        let result = received.lock().unwrap();
        assert!(result[0].contains("Rx"));
        assert!(result[1].contains("Disconnected"));
    }
}
