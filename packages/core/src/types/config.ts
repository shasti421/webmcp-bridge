/**
 * Configuration for Bridge initialization.
 */
export interface BridgeConfig {
  /** Path to semantic YAML definitions directory (or registry source) */
  semanticPath: string;
  healing?: HealingConfig;
  timeouts?: TimeoutConfig;
  logging?: LoggingConfig;
  registry?: RegistryConfig;
}

export interface HealingConfig {
  aiHealing?: boolean;
  humanInLoop?: boolean;
  alertWebhook?: string;
  recordSelector?: boolean;
  createReviewRequest?: boolean;
}

export interface TimeoutConfig {
  navigation?: number;
  element?: number;
  capture?: number;
  action?: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  structured?: boolean;
}

export interface RegistryConfig {
  /** Local registry path (default: ~/.webmcp-bridge/registry/) */
  localPath?: string;
  /** Remote registry URL */
  remoteUrl?: string;
  /** Auth token for remote registry */
  authToken?: string;
}
