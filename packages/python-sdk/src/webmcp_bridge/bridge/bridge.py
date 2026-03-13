"""
Bridge — main entry point for the Python SDK.

Usage:
    from webmcp_bridge import Bridge, BridgeConfig
    from webmcp_bridge.drivers import PlaywrightDriver
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        page = pw.chromium.launch().new_page()
        bridge = Bridge(
            config=BridgeConfig(semantic_path="./my-app-semantic"),
            driver=PlaywrightDriver(page),
        )
        result = bridge.execute("tool_name", {"param": "value"})
        print(result["captured_output"])

The Bridge:
- Loads semantic YAML from config.semantic_path (or from registry)
- Validates YAML against schemas
- Provides execute(tool_name, inputs) → dict of captured outputs
- Provides execute_workflow(name, inputs) → dict
- Provides get_tool_schemas() → list for LLM function calling
- Provides get_strands_tools() → list of @tool decorated callables for Strands Agent
"""
from __future__ import annotations

from typing import Any

from webmcp_bridge.bridge.config import BridgeConfig


class Bridge:
    """Main SDK entry point. Connects semantic definitions to a browser driver."""

    def __init__(self, config: BridgeConfig, driver: Any = None) -> None:
        """
        Args:
            config: Bridge configuration (semantic path, timeouts, etc.)
            driver: A PlaywrightDriver instance (or None for schema-only mode)
        """
        self._config = config
        self._driver = driver
        # TODO: Load semantic store from config.semantic_path or registry
        # TODO: Initialize selector resolver, result capturer, healing pipeline

    def execute(self, tool_name: str, inputs: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool and return captured outputs."""
        # TODO: Implement — load tool def, iterate steps, capture results
        raise NotImplementedError("See spec: docs/specs/python-sdk-spec.md")

    def execute_workflow(self, workflow_name: str, inputs: dict[str, Any]) -> dict[str, Any]:
        """Execute a workflow and return aggregated outputs."""
        raise NotImplementedError

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        """Get all tool schemas for LLM function calling."""
        raise NotImplementedError

    def get_strands_tools(self) -> list[Any]:
        """Get Strands Agent-compatible @tool callables for all loaded tools."""
        # TODO: Import from llm/strands_integration.py
        raise NotImplementedError
