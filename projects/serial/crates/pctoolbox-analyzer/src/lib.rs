//! 逻辑分析仪：采集缓冲区与波形数据模型。
//!
//! 本 crate 只包含纯数据逻辑（与 UI/USB 无关）。USB 采集（rusb）后续加入。

/// 单通道波形数据：每通道一个等间隔采样序列。
#[derive(Debug, Clone)]
pub struct Waveform {
    pub channel: u8,
    pub sample_rate_hz: u32,
    pub samples: Vec<u8>,
}

impl Waveform {
    pub fn new(channel: u8, sample_rate_hz: u32) -> Self {
        Self {
            channel,
            sample_rate_hz,
            samples: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// 第 `i` 个采样点对应的时间（秒）。
    pub fn time_of(&self, i: usize) -> f64 {
        i as f64 / self.sample_rate_hz as f64
    }

    /// 整个波形的时间跨度（秒）。
    pub fn duration_secs(&self) -> f64 {
        self.time_of(self.samples.len().saturating_sub(1))
    }
}

impl Default for Waveform {
    fn default() -> Self {
        Self::new(0, 1_000_000)
    }
}

/// 一次采集会话：多通道波形 + 元数据。
#[derive(Debug, Clone)]
pub struct Capture {
    pub sample_rate_hz: u32,
    pub channels: Vec<Waveform>,
    pub started_at: Option<chrono::DateTime<chrono::Local>>,
}

impl Capture {
    pub fn new(sample_rate_hz: u32, channel_count: u8) -> Self {
        let channels = (0..channel_count)
            .map(|c| Waveform::new(c, sample_rate_hz))
            .collect();
        Self {
            sample_rate_hz,
            channels,
            started_at: None,
        }
    }

    pub fn channel(&self, index: usize) -> Option<&Waveform> {
        self.channels.get(index)
    }

    pub fn push_samples(&mut self, channel_index: usize, samples: &[u8]) {
        if let Some(wave) = self.channels.get_mut(channel_index) {
            wave.samples.extend_from_slice(samples);
        }
    }

    /// 清空所有数据。
    pub fn clear(&mut self) {
        for wave in &mut self.channels {
            wave.samples.clear();
        }
    }

    /// 返回采样点数最多的通道索引。
    pub fn dominant_channel(&self) -> Option<usize> {
        self.channels
            .iter()
            .enumerate()
            .max_by_key(|(_, w)| w.len())
            .map(|(i, _)| i)
    }

    /// 返回总采样点数。
    pub fn total_samples(&self) -> usize {
        self.channels.iter().map(|w| w.len()).sum()
    }
}

impl Default for Capture {
    fn default() -> Self {
        Self::new(1_000_000, 8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_of_matches_sample_rate() {
        let wave = Waveform::new(0, 1_000_000);
        assert_eq!(wave.time_of(0), 0.0);
        assert_eq!(wave.time_of(1000), 0.001);
    }

    #[test]
    fn capture_distributes_samples() {
        let mut cap = Capture::new(100_000, 8);
        cap.push_samples(0, &[1, 1, 0, 1]);
        cap.push_samples(1, &[0, 0, 1]);
        assert_eq!(cap.channel(0).unwrap().len(), 4);
        assert_eq!(cap.channel(1).unwrap().len(), 3);
        assert_eq!(cap.channel(7).unwrap().len(), 0);
    }

    #[test]
    fn dominant_channel_returns_max() {
        let mut cap = Capture::new(100_000, 3);
        cap.push_samples(0, &[0; 10]);
        cap.push_samples(1, &[0; 5]);
        cap.push_samples(2, &[0; 20]);
        assert_eq!(cap.dominant_channel(), Some(2));
    }

    #[test]
    fn total_samples_sum() {
        let mut cap = Capture::new(100_000, 2);
        cap.push_samples(0, &[0; 10]);
        cap.push_samples(1, &[0; 20]);
        assert_eq!(cap.total_samples(), 30);
    }

    #[test]
    fn clear_removes_all_samples() {
        let mut cap = Capture::new(100_000, 2);
        cap.push_samples(0, &[1, 2, 3]);
        cap.push_samples(1, &[4, 5]);
        cap.clear();
        assert_eq!(cap.total_samples(), 0);
    }

    #[test]
    fn waveform_duration_empty() {
        let wave = Waveform::new(0, 1_000_000);
        assert_eq!(wave.duration_secs(), 0.0);
    }

    #[test]
    fn waveform_duration_nonempty() {
        let mut wave = Waveform::new(0, 1_000_000);
        wave.samples = vec![0u8; 100];
        // time_of(99) = 99 / 1_000_000 = 0.000099
        assert!((wave.duration_secs() - 0.000099).abs() < 0.000001);
    }
}
