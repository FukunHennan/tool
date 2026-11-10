use chrono::Local;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Rx,
    Tx,
}

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: chrono::DateTime<Local>,
    pub direction: Direction,
    pub data: Vec<u8>,
}

impl LogEntry {
    pub fn new(direction: Direction, data: Vec<u8>) -> Self {
        Self {
            timestamp: Local::now(),
            direction,
            data,
        }
    }

    pub fn bytes(&self) -> usize {
        self.data.len()
    }

    /// TuiSerial 风格消息：`[14:32:45.123] ◄ RX (   5 B) 48 65 6C 6C 6F`
    pub fn to_hex(&self) -> String {
        let hex = self
            .data
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "[{}] {} ({:>5} B) {}",
            self.timestamp.format("%H:%M:%S%.3f"),
            match self.direction {
                Direction::Rx => "◄ RX",
                Direction::Tx => "► TX",
            },
            self.bytes(),
            hex
        )
    }

    /// TuiSerial 风格消息，文本模式：`[14:32:45.123] ◄ RX (   5 B) Hello`
    pub fn to_text(&self) -> String {
        let text = String::from_utf8_lossy(&self.data);
        format!(
            "[{}] {} ({:>5} B) {}",
            self.timestamp.format("%H:%M:%S%.3f"),
            match self.direction {
                Direction::Rx => "◄ RX",
                Direction::Tx => "► TX",
            },
            self.bytes(),
            text
        )
    }
}

/// 环形缓冲区，最多保留 `capacity` 条记录（TuiSerial 上限为 10000）。
#[derive(Debug, Clone)]
pub struct LogBuffer {
    entries: Vec<LogEntry>,
    capacity: usize,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
            capacity,
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if self.entries.len() == self.capacity {
            self.entries.remove(0);
        }
        self.entries.push(entry);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn iter(&self) -> impl Iterator<Item = &LogEntry> {
        self.entries.iter()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// 返回最后 N 条日志条目。
    pub fn last_n(&self, n: usize) -> Vec<&LogEntry> {
        let start = self.entries.len().saturating_sub(n);
        self.entries[start..].iter().collect()
    }

    /// 搜索包含指定字节序列的条目。
    pub fn search(&self, pattern: &[u8]) -> Vec<&LogEntry> {
        self.entries
            .iter()
            .filter(|e| e.data.windows(pattern.len()).any(|w| w == pattern))
            .collect()
    }

    /// 按方向过滤条目。
    pub fn filter_direction(&self, direction: Direction) -> Vec<&LogEntry> {
        self.entries
            .iter()
            .filter(|e| e.direction == direction)
            .collect()
    }

    /// 统计各方向的数据量。
    pub fn stats(&self) -> (usize, usize, usize, usize) {
        let mut rx_bytes = 0usize;
        let mut tx_bytes = 0usize;
        let mut rx_packets = 0usize;
        let mut tx_packets = 0usize;
        for entry in &self.entries {
            match entry.direction {
                Direction::Rx => {
                    rx_bytes += entry.data.len();
                    rx_packets += 1;
                }
                Direction::Tx => {
                    tx_bytes += entry.data.len();
                    tx_packets += 1;
                }
            }
        }
        (rx_bytes, rx_packets, tx_bytes, tx_packets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_evicts_oldest() {
        let mut buffer = LogBuffer::new(3);
        for i in 0..5u8 {
            buffer.push(LogEntry::new(Direction::Rx, vec![i]));
        }
        assert_eq!(buffer.len(), 3);
        let first = buffer.iter().next().unwrap();
        assert_eq!(first.data, vec![2]);
    }

    #[test]
    fn hex_format_contains_direction_and_bytes() {
        let entry = LogEntry::new(Direction::Rx, vec![0x48, 0x65, 0x6C, 0x6C, 0x6F]);
        let line = entry.to_hex();
        assert!(line.contains("◄ RX"));
        assert!(line.contains("(    5 B)"));
        assert!(line.contains("48 65 6C 6C 6F"));
    }

    #[test]
    fn text_format_shows_readable_string() {
        let entry = LogEntry::new(Direction::Tx, b"Hello".to_vec());
        let line = entry.to_text();
        assert!(line.contains("Hello"));
        assert!(line.contains("► TX"));
    }

    #[test]
    fn last_n_returns_correct_entries() {
        let mut buffer = LogBuffer::new(10);
        for i in 0..5 {
            buffer.push(LogEntry::new(Direction::Rx, vec![i]));
        }
        let last = buffer.last_n(3);
        assert_eq!(last.len(), 3);
        assert_eq!(last[0].data, vec![2]);
        assert_eq!(last[2].data, vec![4]);
    }

    #[test]
    fn search_filters_by_pattern() {
        let mut buffer = LogBuffer::new(10);
        buffer.push(LogEntry::new(Direction::Rx, b"hello".to_vec()));
        buffer.push(LogEntry::new(Direction::Tx, b"world".to_vec()));
        buffer.push(LogEntry::new(Direction::Rx, b"hello world".to_vec()));

        let results = buffer.search(b"hello");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn filter_direction_works() {
        let mut buffer = LogBuffer::new(10);
        buffer.push(LogEntry::new(Direction::Rx, vec![1]));
        buffer.push(LogEntry::new(Direction::Tx, vec![2]));
        buffer.push(LogEntry::new(Direction::Rx, vec![3]));

        let rx = buffer.filter_direction(Direction::Rx);
        let tx = buffer.filter_direction(Direction::Tx);
        assert_eq!(rx.len(), 2);
        assert_eq!(tx.len(), 1);
    }

    #[test]
    fn stats_counts_correctly() {
        let mut buffer = LogBuffer::new(10);
        buffer.push(LogEntry::new(Direction::Rx, vec![1, 2, 3]));
        buffer.push(LogEntry::new(Direction::Tx, vec![4, 5]));
        buffer.push(LogEntry::new(Direction::Rx, vec![6]));

        let (rx_bytes, rx_packets, tx_bytes, tx_packets) = buffer.stats();
        assert_eq!(rx_bytes, 4);
        assert_eq!(rx_packets, 2);
        assert_eq!(tx_bytes, 2);
        assert_eq!(tx_packets, 1);
    }

    #[test]
    fn empty_buffer_has_zero_stats() {
        let buffer = LogBuffer::new(10);
        let (rx_bytes, rx_packets, tx_bytes, tx_packets) = buffer.stats();
        assert_eq!(rx_bytes, 0);
        assert_eq!(rx_packets, 0);
        assert_eq!(tx_bytes, 0);
        assert_eq!(tx_packets, 0);
    }

    #[test]
    fn last_n_on_empty_buffer() {
        let buffer = LogBuffer::new(10);
        assert!(buffer.last_n(5).is_empty());
    }

    #[test]
    fn last_n_with_n_larger_than_len() {
        let mut buffer = LogBuffer::new(10);
        buffer.push(LogEntry::new(Direction::Rx, vec![1]));
        buffer.push(LogEntry::new(Direction::Rx, vec![2]));
        let last = buffer.last_n(100);
        assert_eq!(last.len(), 2);
    }
}
