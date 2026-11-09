/// 24-bucket rolling ring buffer for the period spending cap.
///
/// Each bucket covers `bucket_duration_ns()` nanoseconds.
/// The guaranteed window is `period_ns - one_bucket`, not the full period.
/// Document as: "cap enforced over any window of period − one_bucket."
///
/// Minimum bucket duration: 60 seconds.
/// This ensures the rollback callback cannot hit a reused bucket,
/// since cross-contract callbacks settle well within 60 seconds.

pub const BUCKETS: usize = 24;
pub const MIN_BUCKET_NS: u64 = 60_000_000_000; // 60 s in nanoseconds

/// State held inside ContractState — kept as raw fields for Borsh compat.
/// Callers pass `ring`, `ring_head`, `ring_head_start_ns`, and `period_ns`.
pub struct RingRef<'a> {
    pub ring:               &'a mut [u128; BUCKETS],
    pub ring_head:          &'a mut u8,
    pub ring_head_start_ns: &'a mut u64,
    pub period_ns:          u64,
}

impl<'a> RingRef<'a> {
    fn bucket_duration_ns(&self) -> u64 {
        (self.period_ns / BUCKETS as u64).max(MIN_BUCKET_NS)
    }

    /// Advance stale buckets to `now`.
    /// O(1) when elapsed >= full period; O(BUCKETS) otherwise (at most 24 steps).
    pub fn advance(&mut self, now: u64) {
        if now < *self.ring_head_start_ns {
            // clock anomaly guard (should never happen on NEAR)
            return;
        }
        let elapsed   = now - *self.ring_head_start_ns;
        let bucket_ns = self.bucket_duration_ns();
        let full_ns   = bucket_ns * BUCKETS as u64;

        if elapsed >= full_ns {
            // Entire period has elapsed: clear all buckets in O(1).
            *self.ring = [0u128; BUCKETS];
            *self.ring_head = 0;
            *self.ring_head_start_ns = now;
            return;
        }

        // Advance at most BUCKETS steps to prevent out-of-gas on long idle.
        let steps = ((elapsed / bucket_ns) as usize).min(BUCKETS);
        for _ in 0..steps {
            *self.ring_head = ((*self.ring_head as usize + 1) % BUCKETS) as u8;
            self.ring[*self.ring_head as usize] = 0;
            *self.ring_head_start_ns += bucket_ns;
        }
    }

    /// Sum of all buckets — the current period spend.
    pub fn sum(&self) -> u128 {
        self.ring.iter().sum()
    }

    /// Add `amount` to the current bucket.
    /// Returns the bucket index — **pass this into `ring_sub` on rollback**.
    pub fn add(&mut self, amount: u128) -> u8 {
        self.ring[*self.ring_head as usize] += amount;
        *self.ring_head
    }

    /// Subtract `amount` from the bucket that was active at spend time.
    /// `bucket_index` is the value returned by `add()` — do NOT use the current head.
    pub fn sub(&mut self, amount: u128, bucket_index: u8) {
        self.ring[bucket_index as usize] =
            self.ring[bucket_index as usize].saturating_sub(amount);
    }
}

// ── Unit tests (no sandbox needed; run with `cargo test --lib`) ──────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ring() -> ([u128; BUCKETS], u8, u64) {
        ([0u128; BUCKETS], 0u8, 0u64)
    }

    fn ring_ref<'a>(
        ring:               &'a mut [u128; BUCKETS],
        head:               &'a mut u8,
        head_start:         &'a mut u64,
        period_ns:          u64,
    ) -> RingRef<'a> {
        RingRef { ring, ring_head: head, ring_head_start_ns: head_start, period_ns }
    }

    #[test]
    fn advance_clears_all_buckets_after_full_period() {
        let (mut ring, mut head, mut start) = make_ring();
        let period = 86_400_000_000_000u64; // 24 h
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.add(1_000);
        }
        assert_eq!(ring.iter().sum::<u128>(), 1_000);

        // Advance past full period
        let now = start + period + 1;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now);
        }
        assert_eq!(ring.iter().sum::<u128>(), 0, "all buckets must be cleared after full period");
    }

    #[test]
    fn advance_clears_only_elapsed_buckets() {
        // Semantics: advance(now) moves head forward and zeroes the NEW head bucket
        // (to clear stale data from one full period ago). The OLD head's data stays
        // in the ring — it is still within the current period window.
        let (mut ring, mut head, mut start) = make_ring();
        let period = 86_400_000_000_000u64; // 24 h
        let bucket_ns = (period / BUCKETS as u64).max(MIN_BUCKET_NS);

        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.add(1_000); // lands in bucket 0; head = 0
        }

        // Advance exactly one bucket: head moves 0 → 1; bucket 1 is zeroed.
        // Bucket 0 (with 1_000) is still within the 24-hour window — NOT cleared.
        let now = start + bucket_ns;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now);
        }
        // Sum still = 1_000 (bucket 0 was NOT cleared — it's still in the window)
        assert_eq!(ring.iter().sum::<u128>(), 1_000);
        // New head is now 1; head's bucket (1) was zeroed ready for new spends
        assert_eq!(head, 1);
        assert_eq!(ring[1], 0);
    }

    #[test]
    fn add_returns_correct_bucket_index() {
        let (mut ring, mut head, mut start) = make_ring();
        let period = 86_400_000_000_000u64;
        let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
        let idx = r.add(500);
        assert_eq!(idx, 0, "first add should land in bucket 0");
    }

    #[test]
    fn sub_rolls_back_correct_bucket_after_advance() {
        let (mut ring, mut head, mut start) = make_ring();
        let period = 86_400_000_000_000u64;
        let bucket_ns = (period / BUCKETS as u64).max(MIN_BUCKET_NS);

        // Spend in bucket 0; record index
        let spend_bucket;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            spend_bucket = r.add(999);
        }
        assert_eq!(spend_bucket, 0);

        // Advance head to bucket 1
        let now = start + bucket_ns;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now);
            // Advance cleared bucket 0 → put a new spend in bucket 1
            r.add(1);
        }

        // Roll back the original spend using the saved index
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.sub(999, spend_bucket);
        }

        // Only the new spend in bucket 1 remains
        assert_eq!(ring.iter().sum::<u128>(), 1);
    }

    #[test]
    fn period_cap_enforced_over_period_minus_one_bucket() {
        // Documents the ring buffer guarantee:
        // A spend in bucket N is counted until head advances past N (i.e., for
        // at least period - one_bucket time). After head has advanced past N,
        // that bucket will be zeroed when it becomes the new head again.
        let (mut ring, mut head, mut start) = make_ring();
        let period    = 86_400_000_000_000u64; // 24 h
        let bucket_ns = (period / BUCKETS as u64).max(MIN_BUCKET_NS);
        let cap       = 1_000_000u128;

        // Spend at the cap in bucket 0
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.add(cap);
        }
        assert_eq!(ring.iter().sum::<u128>(), cap);

        // Advance one bucket: head 0 → 1; bucket 1 zeroed; bucket 0 still has `cap`.
        let now = start + bucket_ns;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now);
        }
        // sum() should still see `cap` — bucket 0 is still in the window.
        // The period cap check in spend() uses sum(), so a second spend
        // that would push sum > cap is correctly rejected.
        assert_eq!(ring.iter().sum::<u128>(), cap,
            "bucket 0 spend still visible after advancing one bucket");

        // Only after advancing 24 steps (full period) does bucket 0 get zeroed.
        let now2 = start + period + 1;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now2);
        }
        assert_eq!(ring.iter().sum::<u128>(), 0, "full period clears all buckets");
    }

    #[test]
    fn no_out_of_gas_on_long_idle() {
        // After >> one full period of idle, advance must not loop more than BUCKETS times.
        let (mut ring, mut head, mut start) = make_ring();
        let period = 3_600_000_000_000u64; // 1 h
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.add(42);
        }
        // Simulate 365 days of idle
        let now = start + 365 * 24 * 3_600_000_000_000u64;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now); // must complete without simulating millions of steps
        }
        assert_eq!(ring.iter().sum::<u128>(), 0);
    }

    #[test]
    fn sum_sees_all_buckets_not_just_current() {
        // Mutation target: ring_sum returning only the current bucket instead of
        // summing all 24 would allow bursts larger than the period cap.
        // This test catches that mutant by expecting sum = bucket_0 + bucket_1.
        let (mut ring, mut head, mut start) = make_ring();
        let period    = 86_400_000_000_000u64;
        let bucket_ns = (period / BUCKETS as u64).max(MIN_BUCKET_NS);

        // Spend 100 in bucket 0
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.add(100); // head = 0
        }

        // Advance one bucket: head → 1; bucket 1 is zeroed; bucket 0 still has 100
        let now = start + bucket_ns;
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.advance(now); // head = 1
        }

        // Spend 200 in bucket 1 (the new head)
        {
            let mut r = ring_ref(&mut ring, &mut head, &mut start, period);
            r.add(200); // head = 1
        }

        // sum() must return 300 (bucket 0: 100, bucket 1: 200)
        // A mutant returning only the current bucket would return 200 → FAIL.
        {
            let r = ring_ref(&mut ring, &mut head, &mut start, period);
            assert_eq!(r.sum(), 300,
                "sum must include all buckets; a current-bucket-only mutant returns 200");
        }
    }
}

