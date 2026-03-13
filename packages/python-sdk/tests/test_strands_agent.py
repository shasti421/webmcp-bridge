"""Tests for Strands Agent creation — Issue #23.

Tests the create_bridge_agent() factory with various configurations:
- Default Bedrock model
- All bridge tools loaded
- Provider switching (anthropic, openai, ollama)
- Custom system prompt
- Extra tools alongside bridge tools
- Callback handler support
- System prompt content
"""
from __future__ import annotations

import os
import tempfile
from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest
import yaml

from webmcp_bridge.bridge.bridge import Bridge
from webmcp_bridge.bridge.config import BridgeConfig
from webmcp_bridge.llm.strands_integration import (
    create_bridge_agent,
    create_bridge_tools,
    build_system_prompt,
)


# ─── Fixtures ──────────────────────────────────────────────


APP_YAML = {
    "app": {
        "id": "todo-app",
        "name": "Todo App",
        "base_url": "http://localhost:3000",
        "url_patterns": ["http://localhost:3000/**"],
    }
}

PAGE_YAML = {
    "page": {
        "id": "todo_list",
        "app": "todo-app",
        "url_pattern": "/",
        "url_template": "{{app.base_url}}/",
        "wait_for": ".todo-list",
        "fields": [
            {
                "id": "todo_input",
                "label": "New Todo",
                "type": "text",
                "selectors": [{"strategy": "css", "selector": "input.new-todo"}],
                "interaction": {"type": "text_input"},
            },
            {
                "id": "add_btn",
                "label": "Add",
                "type": "action_button",
                "selectors": [{"strategy": "css", "selector": "button.add-todo"}],
                "interaction": {"type": "click"},
            },
        ],
        "outputs": [
            {
                "id": "todo_count",
                "label": "Item Count",
                "selectors": [{"strategy": "css", "selector": ".todo-count"}],
            }
        ],
    }
}

ADD_TODO_YAML = {
    "tool": {
        "name": "add_todo",
        "description": "Add a new todo item to the list",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The todo item text to add"},
            },
            "required": ["text"],
        },
        "bridge": {
            "page": "todo_list",
            "steps": [
                {"navigate": {"page": "todo_list"}},
                {
                    "interact": {
                        "field": "todo_list.fields.todo_input",
                        "action": "fill",
                        "value": "{{text}}",
                    }
                },
                {"interact": {"action": "click", "target": "todo_list.fields.add_btn"}},
                {
                    "capture": {
                        "from": "todo_list.outputs.todo_count",
                        "store_as": "item_count",
                        "wait": True,
                    }
                },
            ],
            "returns": {"item_count": "{{item_count}}"},
        },
    }
}

DELETE_TODO_YAML = {
    "tool": {
        "name": "delete_todo",
        "description": "Delete a todo item by index",
        "inputSchema": {
            "type": "object",
            "properties": {
                "index": {"type": "integer", "description": "Index of the todo to delete"},
            },
            "required": ["index"],
        },
        "bridge": {
            "page": "todo_list",
            "steps": [{"navigate": {"page": "todo_list"}}],
        },
    }
}


@pytest.fixture
def semantic_dir() -> str:
    """Create temp dir with todo-app semantic YAML files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "app.yaml"), "w") as f:
            yaml.dump(APP_YAML, f)

        pages_dir = os.path.join(tmpdir, "pages")
        os.makedirs(pages_dir)
        with open(os.path.join(pages_dir, "todo_list.yaml"), "w") as f:
            yaml.dump(PAGE_YAML, f)

        tools_dir = os.path.join(tmpdir, "tools")
        os.makedirs(tools_dir)
        with open(os.path.join(tools_dir, "add_todo.yaml"), "w") as f:
            yaml.dump(ADD_TODO_YAML, f)
        with open(os.path.join(tools_dir, "delete_todo.yaml"), "w") as f:
            yaml.dump(DELETE_TODO_YAML, f)

        yield tmpdir


@pytest.fixture
def mock_driver() -> MagicMock:
    driver = MagicMock()
    driver.goto = MagicMock()
    driver.wait_for = MagicMock()
    driver.find_element = MagicMock(return_value=MagicMock())
    driver.click = MagicMock()
    driver.type_text = MagicMock()
    driver.read_text = MagicMock(return_value="3 items left")
    return driver


@pytest.fixture
def bridge(semantic_dir: str, mock_driver: MagicMock) -> Bridge:
    return Bridge(config=BridgeConfig(semantic_path=semantic_dir), driver=mock_driver)


@pytest.fixture
def bridge_no_driver(semantic_dir: str) -> Bridge:
    return Bridge(config=BridgeConfig(semantic_path=semantic_dir))


# ─── Agent Creation Tests ─────────────────────────────────


class TestAgentCreationDefaults:
    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_creates_agent_with_bedrock_by_default(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        agent = create_bridge_agent(bridge)
        mock_create_model.assert_called_once_with(
            "bedrock", "us.anthropic.claude-sonnet-4-20250514-v1:0"
        )
        assert agent is not None

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_agent_has_all_bridge_tools(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge)
        call_kwargs = mock_agent_class.call_args.kwargs
        tools = call_kwargs["tools"]
        assert len(tools) == 2
        tool_names = [t.tool_name for t in tools]
        assert "add_todo" in tool_names
        assert "delete_todo" in tool_names

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_agent_has_auto_generated_system_prompt(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge)
        call_kwargs = mock_agent_class.call_args.kwargs
        system_prompt = call_kwargs["system_prompt"]
        assert "add_todo" in system_prompt
        assert "delete_todo" in system_prompt
        assert "web automation tools" in system_prompt


class TestAgentCreationProviders:
    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_bedrock_provider(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge, model_provider="bedrock", model_id="custom-model")
        mock_create_model.assert_called_once_with("bedrock", "custom-model")

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_anthropic_provider(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge, model_provider="anthropic", model_id="claude-opus-4-6")
        mock_create_model.assert_called_once_with("anthropic", "claude-opus-4-6")

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_openai_provider(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge, model_provider="openai", model_id="gpt-4")
        mock_create_model.assert_called_once_with("openai", "gpt-4")

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_ollama_provider(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge, model_provider="ollama", model_id="llama3")
        mock_create_model.assert_called_once_with("ollama", "llama3")

    def test_unknown_provider_raises(self, bridge: Bridge) -> None:
        with pytest.raises(ValueError, match="Unknown model provider"):
            create_bridge_agent(bridge, model_provider="unknown_ai", model_id="m")


class TestAgentCreationCustomization:
    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_custom_system_prompt(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge, system_prompt="You are a helpful bot.")
        call_kwargs = mock_agent_class.call_args.kwargs
        assert call_kwargs["system_prompt"] == "You are a helpful bot."

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_extra_tools_included(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        extra = MagicMock()
        extra.tool_name = "custom_tool"
        create_bridge_agent(bridge, extra_tools=[extra])
        call_kwargs = mock_agent_class.call_args.kwargs
        tools = call_kwargs["tools"]
        assert len(tools) == 3  # 2 bridge + 1 extra

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_callback_handler_passed(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        handler = MagicMock()
        create_bridge_agent(bridge, callback_handler=handler)
        call_kwargs = mock_agent_class.call_args.kwargs
        assert call_kwargs["callback_handler"] is handler

    @patch("webmcp_bridge.llm.strands_integration.Agent")
    @patch("webmcp_bridge.llm.strands_integration._create_model")
    def test_no_callback_handler_by_default(
        self, mock_create_model: MagicMock, mock_agent_class: MagicMock, bridge: Bridge
    ) -> None:
        mock_create_model.return_value = MagicMock()
        create_bridge_agent(bridge)
        call_kwargs = mock_agent_class.call_args.kwargs
        assert "callback_handler" not in call_kwargs


# ─── System Prompt Tests ──────────────────────────────────


class TestBuildSystemPrompt:
    def test_includes_all_tool_names(self, bridge: Bridge) -> None:
        prompt = build_system_prompt(bridge)
        assert "add_todo" in prompt
        assert "delete_todo" in prompt

    def test_includes_tool_descriptions(self, bridge: Bridge) -> None:
        prompt = build_system_prompt(bridge)
        assert "Add a new todo item" in prompt
        assert "Delete a todo item" in prompt

    def test_includes_parameter_info(self, bridge: Bridge) -> None:
        prompt = build_system_prompt(bridge)
        assert "text" in prompt
        assert "index" in prompt
        assert "(required)" in prompt

    def test_includes_instructions(self, bridge: Bridge) -> None:
        prompt = build_system_prompt(bridge)
        assert "Instructions:" in prompt
        assert "tool calls" in prompt

    def test_empty_tools_still_works(self, semantic_dir: str) -> None:
        # Remove tools
        tools_dir = os.path.join(semantic_dir, "tools")
        for f in os.listdir(tools_dir):
            os.remove(os.path.join(tools_dir, f))
        bridge = Bridge(config=BridgeConfig(semantic_path=semantic_dir))
        prompt = build_system_prompt(bridge)
        assert "Available tools:" in prompt


# ─── Tool Execution via Agent Tests ───────────────────────


class TestToolExecutionViaAgent:
    def test_tool_calls_bridge_execute(
        self, bridge: Bridge, mock_driver: MagicMock
    ) -> None:
        """When a generated tool is called, it delegates to bridge.execute()."""
        tools = create_bridge_tools(bridge)
        add_tool = next(t for t in tools if t.tool_name == "add_todo")

        result = add_tool(text="Buy milk")

        # Verify the driver was used (bridge.execute was called)
        mock_driver.goto.assert_called()
        mock_driver.type_text.assert_called()
        mock_driver.click.assert_called()
        assert "item_count" in result

    def test_tool_returns_correct_output(
        self, bridge: Bridge, mock_driver: MagicMock
    ) -> None:
        tools = create_bridge_tools(bridge)
        add_tool = next(t for t in tools if t.tool_name == "add_todo")

        result = add_tool(text="Test item")
        assert result["item_count"] == "3 items left"

    def test_multiple_tool_calls(
        self, bridge: Bridge, mock_driver: MagicMock
    ) -> None:
        tools = create_bridge_tools(bridge)
        add_tool = next(t for t in tools if t.tool_name == "add_todo")

        result1 = add_tool(text="First")
        result2 = add_tool(text="Second")

        assert result1 is not None
        assert result2 is not None
        assert mock_driver.goto.call_count == 2


# ─── Bridge Integration convenience ──────────────────────


class TestBridgeGetStrandsTools:
    def test_bridge_get_strands_tools_returns_tools(
        self, bridge: Bridge
    ) -> None:
        """Bridge.get_strands_tools() should delegate to create_bridge_tools."""
        tools = bridge.get_strands_tools()
        assert len(tools) == 2
        names = [t.tool_name for t in tools]
        assert "add_todo" in names
        assert "delete_todo" in names
