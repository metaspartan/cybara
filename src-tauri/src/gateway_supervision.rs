use std::time::Duration;

pub const HEALTH_FAILURE_THRESHOLD: u8 = 10;
pub const MAX_RESTART_ATTEMPTS: u8 = 4;
pub const STABLE_HEALTH_THRESHOLD: u8 = 5;

#[derive(Debug, PartialEq, Eq)]
pub enum RestartPlan {
    Retry { attempt: u8, delay: Duration },
    Exhausted,
    AlreadyScheduled,
    ShuttingDown,
}

#[derive(Default)]
pub struct GatewaySupervision {
    consecutive_health_failures: u8,
    restart_attempts: u8,
    restart_scheduled: bool,
    shutting_down: bool,
    stable_health_checks: u8,
}

impl GatewaySupervision {
    pub fn record_healthy(&mut self) {
        self.consecutive_health_failures = 0;
        self.stable_health_checks = self.stable_health_checks.saturating_add(1);
        if self.stable_health_checks >= STABLE_HEALTH_THRESHOLD {
            self.restart_attempts = 0;
        }
    }

    pub fn record_unhealthy(&mut self) -> bool {
        self.consecutive_health_failures = self.consecutive_health_failures.saturating_add(1);
        self.stable_health_checks = 0;
        self.consecutive_health_failures >= HEALTH_FAILURE_THRESHOLD
    }

    pub fn schedule_restart(&mut self) -> RestartPlan {
        if self.shutting_down {
            return RestartPlan::ShuttingDown;
        }
        if self.restart_scheduled {
            return RestartPlan::AlreadyScheduled;
        }
        self.restart_attempts = self.restart_attempts.saturating_add(1);
        if self.restart_attempts > MAX_RESTART_ATTEMPTS {
            return RestartPlan::Exhausted;
        }
        self.consecutive_health_failures = 0;
        self.restart_scheduled = true;
        RestartPlan::Retry {
            attempt: self.restart_attempts,
            delay: Duration::from_secs(1_u64 << (self.restart_attempts - 1)),
        }
    }

    pub fn begin_scheduled_restart(&mut self) -> bool {
        if self.shutting_down || !self.restart_scheduled {
            return false;
        }
        self.restart_scheduled = false;
        true
    }

    pub fn mark_shutting_down(&mut self) {
        self.shutting_down = true;
        self.restart_scheduled = false;
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GatewaySupervision, HEALTH_FAILURE_THRESHOLD, MAX_RESTART_ATTEMPTS, RestartPlan,
        STABLE_HEALTH_THRESHOLD,
    };
    use std::time::Duration;

    #[test]
    fn requires_consecutive_health_failures_before_restarting() {
        let mut supervision = GatewaySupervision::default();
        for _ in 1..HEALTH_FAILURE_THRESHOLD {
            assert!(!supervision.record_unhealthy());
        }
        assert!(supervision.record_unhealthy());
        for _ in 0..STABLE_HEALTH_THRESHOLD {
            supervision.record_healthy();
        }
        assert!(!supervision.record_unhealthy());
    }

    #[test]
    fn caps_restarts_with_exponential_backoff() {
        let mut supervision = GatewaySupervision::default();
        for attempt in 1..=MAX_RESTART_ATTEMPTS {
            assert_eq!(
                supervision.schedule_restart(),
                RestartPlan::Retry {
                    attempt,
                    delay: Duration::from_secs(1_u64 << (attempt - 1)),
                }
            );
            assert_eq!(
                supervision.schedule_restart(),
                RestartPlan::AlreadyScheduled
            );
            assert!(supervision.begin_scheduled_restart());
        }
        assert_eq!(supervision.schedule_restart(), RestartPlan::Exhausted);
    }

    #[test]
    fn stable_gateway_resets_restart_budget() {
        let mut supervision = GatewaySupervision::default();
        assert!(matches!(
            supervision.schedule_restart(),
            RestartPlan::Retry { attempt: 1, .. }
        ));
        assert!(supervision.begin_scheduled_restart());
        supervision.record_healthy();
        assert!(matches!(
            supervision.schedule_restart(),
            RestartPlan::Retry { attempt: 2, .. }
        ));
        assert!(supervision.begin_scheduled_restart());
        for _ in 0..STABLE_HEALTH_THRESHOLD {
            supervision.record_healthy();
        }
        assert!(matches!(
            supervision.schedule_restart(),
            RestartPlan::Retry { attempt: 1, .. }
        ));
    }

    #[test]
    fn shutdown_cancels_pending_and_future_restarts() {
        let mut supervision = GatewaySupervision::default();
        assert!(matches!(
            supervision.schedule_restart(),
            RestartPlan::Retry { .. }
        ));
        supervision.mark_shutting_down();
        assert!(!supervision.begin_scheduled_restart());
        assert_eq!(supervision.schedule_restart(), RestartPlan::ShuttingDown);
    }
}
