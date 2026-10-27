# Cursor execution adapter gap matrix (WP8)

| Capability | Fake transport | Local SDK | Cloud API |
| --- | --- | --- | --- |
| Execution identity | Implemented | Documented | Documented |
| Workspace isolation | Mocked | Unverified | Unverified |
| Repository ownership | Mocked | Unverified | Unverified |
| Process lifecycle | Mocked | Not implemented | Not implemented |
| Progress events | Implemented | Not implemented | Partial via REST types |
| Cancellation | Implemented (fake) | Disabled | Disabled |
| Timeouts | Runner polling only | Not implemented | Not implemented |
| Structured errors | Partial | Not implemented | Partial |
| Evidence collection | Consumer API | Not implemented | Not implemented |
| Follow-up instructions | Closed-loop manager | Not implemented | Not implemented |
| Cost limits | File budget + objective ledger | Not implemented | Not implemented |

Live modes remain disabled (`CAM_CURSOR_EXECUTION_ADAPTER_ENABLED` unset).
