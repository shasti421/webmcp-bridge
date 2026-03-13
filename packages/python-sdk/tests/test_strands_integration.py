"""Tests for Strands Agents integration — tool generation and agent creation."""
from __future__ import annotations

import os
import tempfile
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml

from webmcp_bridge.bridge.bridge import Bridge
from webmcp_bridge.bridge.config import BridgeConfig
from webmcp_bridge.llm.strands_integration import create_bridge_tools, create_bridge_agent


# ─── Fixtures ──────────────────────────────────────────────


APP_YAML = {
    "app": {
        "id": "test-app",
        "name": "Test App",
        "base_url": "http://localhost:3000",
        "url_patterns": ["http://localhost:3000/**"],
    }
}

PAGE_YAML = {
    "page": {
        "id": "test_page",
        "app": "test-app",
        "url_pattern": "/",
        "url_template": "{{app.base_url}}/",
        "wait_for": ".ready",
        "fields": [
            {
                "id": "name_input",
                "label": "Name",
                "type": "text",
                "selectors": [{"strategy": "css", "selector": "#name"}],
                "interaction": {"type": "text_input"},
            },
            {
                "id": "submit_btn",
                "label": "Submit",
                "type": "action_button",
                "selectors": [{"strategy": "css", "selector": "#submit"}],
                "interaction": {"type": "click"},
            },
        ],
        "outputs": [
            {
                "id": "result_text",
                "label": "Result",
                "selectors": [{"strategy": "css", "selector": ".result"}],
            }
        ],
    }
}

TOOL1_YAML = {
    "tool": {
        "name": "create_item",
        "description": "Create a new item in the system",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Item name"},
                "priority": {"type": "integer", "description": "Priority level"},
            },
            "required": ["name"],
        },
        "bridge": {
            "page": "test_page",
            "steps": [
                {"navigate": {"page": "test_page"}},
                {
                    "interact": {
                        "field": "test_page.fields.name_input",
                        "action": "fill",
                        "value": "{{name}}",
                    }
                },
                {"interact": {"action": "click", "target": "test_page.fields.submit_btn"}},
                {
                    "capture": {
                        "from": "test_page.outputs.result_text",
                        "store_as": "result",
                        "wait": True,
                    }
                },
            ],
            "returns": {"result": "{{result}}"},
        },
    }
}

TOOL2_YAML = {
    "tool": {
        "name": "delete_item",
        "description": "Delete an item by ID",
        "inputSchema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string", "description": "Item ID to delete"},
            },
            "required": ["item_id"],
        },
        "bridge": {
            "page": "test_page",
            "steps": [{"navigate": {"page": "test_page"}}],
        },
    }
}


@pytest.fixture
def semantic_dir() -> str:
    """Create temp dir with semantic YAML files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "app.yaml"), "w") as f:
            yaml.dump(APP_YAML, f)

        pages_dir = os.path.join(tmpdir, "pages")
        os.makedirs(pages_dir)
        with open(os.path.join(pages_dir, "test_page.yaml"), "w") as f:
            yaml.dump(PAGE_YAML, f)

        tools_dir = os.path.join(tmpdir, "tools")
        os.makedirs(tools_dir)
        with open(os.path.join(tools_dir, "create_item.yaml"), "w") as f:
            yaml.dump(TOOL1_YAML, f)
        with open(os.path.join(tools_dir, "delete_item.yaml"), "w") as f:
            yaml.dump(TOOL2_YAML, f)

        yield tmpdir


@pytest.fixture
def mock_driver() -> MagicMock:
    driver = MagicMock()
    driver.goto = MagicMock()
    driver.wait_for = MagicMock()
    driver.find_element = MagicMock(return_value=MagicMock())
    driver.click = MagicMock()
    driver.type_text = MagicMock()
    driver.read_text = MagicMock(return_value="created ok")
    return driver


@pytest.fixture
def bridge(semantic_dir: str, mock_driver: MagicMock) -> Bridge:
    config = BridgeConfig(semantic_path=semantic_dir)
    return Bridge(config=config, driver=mock_driver)


@pytest.fixture
def bridge_no_driver(semantic_dir: str) -> Bridge:
    config = BridgeConfig(semantic_path=semantic_dir)
    return Bridge(config=config)


# ─── create_bridge_tools Tests ────────────────────────────


class TestCreateBridgeTools:
    def test_returns_list(self, bridge: Bridge) -> None:
        tools = create_bridge_tools(bridge)
        assert isinstance(tools, list)

    def test_correct_number_of_tools(self, bridge: Bridge) -> None:
        tools = create_bridge_tools(bridge)
        assert len(tools) == 2

    def test_tool_has_name(self, bridge: Bridge) -> None:
        tools = create_bridge_tools(bridge)
        names = [t.tool_name for t in tools]
        assert "create_item" in names
        assert "delete_item" in names

    def test_tool_has_description(self, bridge: Bridge) -> None:
        tools = create_bridge_tools(bridge)
        # Find create_item tool
        create_tool = next(t for t in tools if t.tool_name == "create_item")
        assert "Create a new item" in create_tool.tool_spec["description"]

    def test_tool_has_input_schema(self, bridge: Bridge) -> None:
        tools = create_bridge_tools(bridge)
        create_tool = next(t for t in tools if t.tool_name == "create_item")
        spec = create_tool.tool_spec
        assert "inputSchema" in spec
        assert spec["inputSchema"]["type"] == "object"
        assert "name" in spec["inputSchema"]["properties"]

    def test_tool_callable_executes_bridge(self, bridge: Bridge, mock_driver: MagicMock) -> None:
        """When called directly, the tool should call bridge.execute()."""
        tools = create_bridge_tools(bridge)
        create_tool = next(t for t in tools if t.tool_name == "create_item")

        # Call tool directly with kwargs
        result = create_tool(name="Test Item")
        # Should have called bridge.execute under the hood
        assert result is not None
        # Verify driver was called (bridge.execute was invoked)
        mock_driver.goto.assert_called()

    def test_tool_direct_call(self, bridge: Bridge) -> None:
        """Tools should also work when called directly with kwargs."""
        tools = create_bridge_tools(bridge)
        create_tool = next(t for t in tools if t.tool_name == "create_item")
        result = create_tool(name="Test Item")
        assert result is not None

    def test_empty_tools_returns_empty_list(self, semantic_dir: str) -> None:
        """Bridge with no tools should return empty list."""
        # Remove tools dir
        tools_dir = os.path.join(semantic_dir, "tools")
        for f in os.listdir(tools_dir):
            os.remove(os.path.join(tools_dir, f))

        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        tools = create_bridge_tools(bridge)
        assert len(tools) == 0


# ─── create_bridge_agent Tests ────────────────────────────


class TestCreateBridgeAgent:
    @patch("webmcp_bridge.llm.strands_integration.Agent")
    def test_creates_agent(self, mock_agent_class: MagicMock, bridge: Bridge) -> None:
        agent = create_bridge_agent(bridge, model_provider="bedrock", model_id="test-model")
        mock_agent_class.assert_called_once()
        assert agent is not None

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    def test_agent_has_tools(self, mock_agent_class: MagicMock, bridge: Bridge) -> None:
        create_bridge_agent(bridge, model_provider="bedrock", model_id="test-model")
        call_kwargs = mock_agent_class.call_args
        tools = call_kwargs.kwargs.get("tools") or call_kwargs[1].get("tools")
        assert tools is not None
        assert len(tools) == 2

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    def test_agent_has_system_prompt(
        self, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        create_bridge_agent(bridge, model_provider="bedrock", model_id="test-model")
        call_kwargs = mock_agent_class.call_args
        system_prompt = call_kwargs.kwargs.get("system_prompt") or call_kwargs[1].get(
            "system_prompt"
        )
        assert system_prompt is not None
        assert "create_item" in system_prompt
        assert "delete_item" in system_prompt

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    def test_custom_system_prompt(
        self, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        create_bridge_agent(
            bridge,
            model_provider="bedrock",
            model_id="test-model",
            system_prompt="Custom prompt",
        )
        call_kwargs = mock_agent_class.call_args
        system_prompt = call_kwargs.kwargs.get("system_prompt") or call_kwargs[1].get(
            "system_prompt"
        )
        assert system_prompt == "Custom prompt"

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    def test_bedrock_model_provider(
        self, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        create_bridge_agent(bridge, model_provider="bedrock", model_id="test-model")
        call_kwargs = mock_agent_class.call_args
        model = call_kwargs.kwargs.get("model") or call_kwargs[1].get("model")
        assert model is not None

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_anthropic_model_provider(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge, model_provider="anthropic", model_id="claude-opus-4-6")
        mock_create_model.assert_called_once_with("anthropic", "claude-opus-4-6")
        mock_agent_class.assert_called_once()

    def test_unknown_provider_raises(self, bridge: Bridge) -> None:
        with pytest.raises(ValueError, match="Unknown model provider"):
            create_bridge_agent(bridge, model_provider="unknown_provider", model_id="m")
