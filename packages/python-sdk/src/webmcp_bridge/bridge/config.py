"""Bridge configuration."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BridgeConfig:
    """Configuration for Bridge initialization."""

    semantic_path: str
    """Path to directory containing semantic YAML definitions."""

    registry_url: str | None = None
    """Optional remote registry URL for pulling definitions."""

    registry_token: str | None = None
    """Auth token for remote registry."""

    navigation_timeout_ms: int = 30000
    element_timeout_ms: int = 10000
    capture_timeout_ms: int = 10000

    ai_healing: bool = False
    """Enable AI-based selector healing (requires LLM provider)."""

    log_level: str = "info"

    model_provider: str = "bedrock"
    """Strands model provider: bedrock, anthropic, openai, ollama, etc."""

    model_id: str = "us.anthropic.claude-sonnet-4-20250514-v1:0"
    """Model ID for Strands agent (healing + NLP)."""
