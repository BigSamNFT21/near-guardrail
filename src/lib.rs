use near_sdk::store::{IterableMap, IterableSet, Vector};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const DAY_NS: u64 = 86_400_000_000_000;
const STORAGE_RESERVE: NearToken = NearToken::from_near(1);

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct AuditEntry {
    pub id: u64,
    pub timestamp_ns: u64,
    pub agent: AccountId,
    pub recipient: AccountId,
    pub amount: NearToken,
    pub memo: String,
    /// "paid" | "blocked" | "pending" | "rejected"
    pub status: String,
    pub reason: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct PolicyView {
    pub owner: AccountId,
    pub per_tx_cap: NearToken,
    pub daily_cap: NearToken,
    pub approval_threshold: NearToken,
    pub paused: bool,
    pub spent_today: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guardrail {
    owner: AccountId,
    agents: IterableSet<AccountId>,
    allowlist: IterableSet<AccountId>,
    per_tx_cap: NearToken,
    daily_cap: NearToken,
    approval_threshold: NearToken,
    paused: bool,
    spent_day: u64,
    spent_today: NearToken,
    log: Vector<AuditEntry>,
    pending: IterableMap<u64, AuditEntry>,
}

#[near]
impl Guardrail {
    #[init]
    pub fn new(
        owner: AccountId,
        per_tx_cap: NearToken,
        daily_cap: NearToken,
        approval_threshold: NearToken,
    ) -> Self {
        Self {
            owner,
            agents: IterableSet::new(b"a"),
            allowlist: IterableSet::new(b"w"),
            per_tx_cap,
            daily_cap,
            approval_threshold,
            paused: false,
            spent_day: env::block_timestamp() / DAY_NS,
            spent_today: NearToken::from_yoctonear(0),
            log: Vector::new(b"l"),
            pending: IterableMap::new(b"p"),
        }
    }

    // ---------- owner controls ----------

    pub fn add_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agents.insert(agent);
    }

    pub fn remove_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agents.remove(&agent);
    }

    pub fn allow_recipient(&mut self, recipient: AccountId) {
        self.assert_owner();
        self.allowlist.insert(recipient);
    }

    pub fn remove_recipient(&mut self, recipient: AccountId) {
        self.assert_owner();
        self.allowlist.remove(&recipient);
    }

    pub fn set_policy(
        &mut self,
        per_tx_cap: NearToken,
        daily_cap: NearToken,
        approval_threshold: NearToken,
    ) {
        self.assert_owner();
        self.per_tx_cap = per_tx_cap;
        self.daily_cap = daily_cap;
        self.approval_threshold = approval_threshold;
    }

    /// Kill switch: halts every agent payment immediately.
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    pub fn approve(&mut self, id: u64) -> AuditEntry {
        self.assert_owner();
        require!(!self.paused, "Kill switch is active");
        let p = self
            .pending
            .remove(&id)
            .expect("No pending payment with that id");
        self.roll_day();
        require!(
            p.amount.as_yoctonear() <= self.available_balance(),
            "Insufficient vault balance"
        );
        self.spent_today = NearToken::from_yoctonear(
            self.spent_today.as_yoctonear() + p.amount.as_yoctonear(),
        );
        Promise::new(p.recipient.clone()).transfer(p.amount).detach();
        self.set_status(id, "paid", "approved by owner")
    }

    pub fn reject(&mut self, id: u64) -> AuditEntry {
        self.assert_owner();
        self.pending
            .remove(&id)
            .expect("No pending payment with that id");
        self.set_status(id, "rejected", "rejected by owner")
    }

    // ---------- agent entry points ----------

    /// The only way an agent can move money. Never panics on a policy
    /// violation (a panic would revert the audit log); it returns the verdict.
    pub fn request_payment(
        &mut self,
        recipient: AccountId,
        amount: NearToken,
        memo: String,
    ) -> AuditEntry {
        let agent = env::predecessor_account_id();
        require!(self.agents.contains(&agent), "Caller is not a registered agent");
        self.roll_day();

        match self.check(&recipient, amount) {
            Err(reason) => self.record(agent, recipient, amount, memo, "blocked", &reason),
            Ok(true) => {
                let entry = self.record(
                    agent,
                    recipient,
                    amount,
                    memo,
                    "pending",
                    "above approval threshold, waiting for owner",
                );
                self.pending.insert(entry.id, entry.clone());
                entry
            }
            Ok(false) => {
                self.spent_today = NearToken::from_yoctonear(
                    self.spent_today.as_yoctonear() + amount.as_yoctonear(),
                );
                Promise::new(recipient.clone()).transfer(amount).detach();
                self.record(agent, recipient, amount, memo, "paid", "within policy")
            }
        }
    }

    /// Lets the off-chain scam / prompt-injection check write its blocks
    /// into the same on-chain audit log.
    pub fn log_block(
        &mut self,
        recipient: AccountId,
        amount: NearToken,
        memo: String,
        reason: String,
    ) -> AuditEntry {
        let agent = env::predecessor_account_id();
        require!(self.agents.contains(&agent), "Caller is not a registered agent");
        self.record(agent, recipient, amount, memo, "blocked", &reason)
    }

    // ---------- views ----------

    pub fn get_policy(&self) -> PolicyView {
        PolicyView {
            owner: self.owner.clone(),
            per_tx_cap: self.per_tx_cap,
            daily_cap: self.daily_cap,
            approval_threshold: self.approval_threshold,
            paused: self.paused,
            spent_today: self.spent_today,
        }
    }

    pub fn get_log(&self, from_index: u32, limit: u32) -> Vec<AuditEntry> {
        self.log
            .iter()
            .skip(from_index as usize)
            .take(limit as usize)
            .cloned()
            .collect()
    }

    pub fn get_pending(&self) -> Vec<AuditEntry> {
        self.pending.values().cloned().collect()
    }

    pub fn get_allowlist(&self) -> Vec<AccountId> {
        self.allowlist.iter().cloned().collect()
    }

    pub fn get_agents(&self) -> Vec<AccountId> {
        self.agents.iter().cloned().collect()
    }
}

// Private helpers (not exposed as contract methods).
impl Guardrail {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can call this"
        );
    }

    fn roll_day(&mut self) {
        let today = env::block_timestamp() / DAY_NS;
        if today != self.spent_day {
            self.spent_day = today;
            self.spent_today = NearToken::from_yoctonear(0);
        }
    }

    fn available_balance(&self) -> u128 {
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(STORAGE_RESERVE.as_yoctonear())
    }

    /// Ok(true) = allowed but needs owner approval, Ok(false) = allowed now,
    /// Err(reason) = blocked.
    fn check(&self, recipient: &AccountId, amount: NearToken) -> Result<bool, String> {
        if self.paused {
            return Err("kill switch active: all payments halted".to_string());
        }
        if amount.as_yoctonear() == 0 {
            return Err("amount must be greater than zero".to_string());
        }
        if amount > self.per_tx_cap {
            return Err(format!("exceeds per-transaction cap of {}", self.per_tx_cap));
        }
        if !self.allowlist.contains(recipient) {
            return Err(format!("recipient {} is not on the allowlist", recipient));
        }
        let projected = self.spent_today.as_yoctonear() + amount.as_yoctonear();
        if projected > self.daily_cap.as_yoctonear() {
            return Err(format!("would exceed daily cap of {}", self.daily_cap));
        }
        if amount.as_yoctonear() > self.available_balance() {
            return Err("insufficient vault balance".to_string());
        }
        Ok(amount > self.approval_threshold)
    }

    fn record(
        &mut self,
        agent: AccountId,
        recipient: AccountId,
        amount: NearToken,
        memo: String,
        status: &str,
        reason: &str,
    ) -> AuditEntry {
        let entry = AuditEntry {
            id: self.log.len() as u64,
            timestamp_ns: env::block_timestamp(),
            agent,
            recipient,
            amount,
            memo,
            status: status.to_string(),
            reason: reason.to_string(),
        };
        self.log.push(entry.clone());
        Self::emit(&entry);
        entry
    }

    fn set_status(&mut self, id: u64, status: &str, reason: &str) -> AuditEntry {
        let entry = self
            .log
            .get_mut(id as u32)
            .expect("Log entry missing");
        entry.status = status.to_string();
        entry.reason = reason.to_string();
        let out = entry.clone();
        Self::emit(&out);
        out
    }

    fn emit(entry: &AuditEntry) {
        env::log_str(&format!(
            "GUARDRAIL_EVENT:{}",
            near_sdk::serde_json::to_string(entry).unwrap()
        ));
    }
}
