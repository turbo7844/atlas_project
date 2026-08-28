export interface ConnectorPayload {
  raw: string;
  receivedAt: Date;
}

export interface DataConnector {
  readonly key: string;
  load(): Promise<ConnectorPayload>;
}
