use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub enum InspectorEvent {
    ProxyStatusChanged(crate::proxy::ProxyStatus),
    SessionStatusChanged(crate::session::SessionStatus),
    TransactionCreated(crate::traffic::HttpTransaction),
    TransactionUpdated(crate::traffic::HttpTransaction),
    TransactionCompleted(crate::traffic::HttpTransaction),
    ComparisonCompleted {
        transaction_id: Uuid,
        comparison: crate::comparison::ResponseComparison,
    },
    IncidentCreated(crate::diagnostics::LogIncident),
    IssueCreated(crate::issues::Issue),
    DeviceStatusChanged(String),
}

#[derive(Clone)]
pub struct EventBroadcaster {
    sender: broadcast::Sender<InspectorEvent>,
}
impl Default for EventBroadcaster {
    fn default() -> Self {
        Self::new(512)
    }
}
impl EventBroadcaster {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }
    pub fn send(&self, event: InspectorEvent) {
        let _ = self.sender.send(event);
    }
    pub fn subscribe(&self) -> broadcast::Receiver<InspectorEvent> {
        self.sender.subscribe()
    }
}
