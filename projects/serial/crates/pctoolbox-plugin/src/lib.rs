//! 数据拦截钩子管线。
//!
//! 对齐 TuiSerial 的插件钩子：`on_load` / `on_unload` / `on_connect` /
//! `on_disconnect` / `on_rx(data)` / `on_tx(data)`。插件可以改写传输中的
//! 数据（返回 `None` 表示丢弃该包）。
//!
//! 当前版本只有纯 Rust 钩子注册；JS 插件运行时（boa_engine）后续加入。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookEvent {
    Connect,
    Disconnect,
}

/// 单个插件钩子集合。
pub trait PluginHooks: Send {
    fn on_load(&mut self) {}
    fn on_unload(&mut self) {}
    fn on_event(&mut self, _event: HookEvent) {}
    /// 拦截接收数据，返回 `None` 丢弃，`Some` 改写后放行。
    fn on_rx(&mut self, data: Vec<u8>) -> Option<Vec<u8>> {
        Some(data)
    }
    /// 拦截发送数据，返回 `None` 取消发送。
    fn on_tx(&mut self, data: Vec<u8>) -> Option<Vec<u8>> {
        Some(data)
    }
}

#[derive(Default)]
pub struct HookPipeline {
    hooks: Vec<Box<dyn PluginHooks>>,
}

impl HookPipeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, hook: Box<dyn PluginHooks>) {
        self.hooks.push(hook);
    }

    pub fn clear(&mut self) {
        self.hooks.clear();
    }

    pub fn len(&self) -> usize {
        self.hooks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.hooks.is_empty()
    }

    pub fn notify(&mut self, event: HookEvent) {
        for hook in &mut self.hooks {
            hook.on_event(event);
        }
    }

    pub fn process_rx(&mut self, data: Vec<u8>) -> Vec<u8> {
        self.hooks
            .iter_mut()
            .fold(data, |acc, hook| hook.on_rx(acc).unwrap_or_default())
    }

    pub fn process_tx(&mut self, data: Vec<u8>) -> Option<Vec<u8>> {
        self.hooks
            .iter_mut()
            .fold(Some(data), |acc, hook| acc.and_then(|d| hook.on_tx(d)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 把收到的每个字节 +1 的测试插件。
    struct ShiftPlugin(u8);

    impl PluginHooks for ShiftPlugin {
        fn on_rx(&mut self, data: Vec<u8>) -> Option<Vec<u8>> {
            Some(data.into_iter().map(|b| b.wrapping_add(self.0)).collect())
        }
    }

    /// 丢弃所有 TX 数据的插件。
    struct DropTx;

    impl PluginHooks for DropTx {
        fn on_tx(&mut self, _data: Vec<u8>) -> Option<Vec<u8>> {
            None
        }
    }

    /// 转换 RX 数据的插件（大写）。
    struct UpperRx;

    impl PluginHooks for UpperRx {
        fn on_rx(&mut self, data: Vec<u8>) -> Option<Vec<u8>> {
            Some(data.into_iter().map(|b| b.to_ascii_uppercase()).collect())
        }
    }

    #[test]
    fn rx_hook_transforms_data() {
        let mut pipeline = HookPipeline::new();
        pipeline.add(Box::new(ShiftPlugin(1)));
        assert_eq!(pipeline.process_rx(vec![1, 2, 3]), vec![2, 3, 4]);
    }

    #[test]
    fn tx_hook_can_suppress_send() {
        let mut pipeline = HookPipeline::new();
        pipeline.add(Box::new(DropTx));
        assert_eq!(pipeline.process_tx(vec![1, 2]), None);
    }

    #[test]
    fn multiple_hooks_chain_in_order() {
        let mut pipeline = HookPipeline::new();
        pipeline.add(Box::new(ShiftPlugin(1)));
        pipeline.add(Box::new(ShiftPlugin(2)));
        assert_eq!(pipeline.process_rx(vec![1]), vec![4]);
    }

    #[test]
    fn empty_pipeline_passes_through() {
        let mut pipeline = HookPipeline::new();
        assert_eq!(pipeline.process_rx(vec![1, 2, 3]), vec![1, 2, 3]);
        assert_eq!(pipeline.process_tx(vec![1, 2]), Some(vec![1, 2]));
    }

    #[test]
    fn hook_can_convert_case() {
        let mut pipeline = HookPipeline::new();
        pipeline.add(Box::new(UpperRx));
        assert_eq!(
            pipeline.process_rx(vec![b'a', b'b', b'c']),
            vec![b'A', b'B', b'C']
        );
    }

    #[test]
    fn notify_calls_hooks() {
        struct EventCounter {
            count: std::sync::Arc<std::sync::Mutex<usize>>,
        }
        impl PluginHooks for EventCounter {
            fn on_event(&mut self, _event: HookEvent) {
                *self.count.lock().unwrap() += 1;
            }
        }

        let counter = std::sync::Arc::new(std::sync::Mutex::new(0usize));
        let mut pipeline = HookPipeline::new();
        pipeline.add(Box::new(EventCounter {
            count: counter.clone(),
        }));

        pipeline.notify(HookEvent::Connect);
        pipeline.notify(HookEvent::Disconnect);

        assert_eq!(*counter.lock().unwrap(), 2);
    }
}
