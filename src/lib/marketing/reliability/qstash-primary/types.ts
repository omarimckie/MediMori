export type QstashVerifiedDeliveryInput = {
  signature: string;
  rawBody: string;
  untrustedMessageId?: string | null;
};

export type QstashVerifiedDeliveryIdentity = {
  jti: string;
};

export type RecordVerifiedPrimaryHeartbeatResult =
  | {
      outcome: "advanced";
      jti: string;
      lastSeenAt: string;
    }
  | {
      outcome: "duplicate_jti";
      jti: string;
      lastSeenAt: string;
    };
