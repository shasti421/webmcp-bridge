"""Tests for the Bridge class — Python Bridge Core."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
import yaml

from webmcp_bridge.bridge.bridge import Bridge
from webmcp_bridge.bridge.config import BridgeConfig


# ─── Fixtures ──────────────────────────────────────────────


APP_YAML = {
    "app": {
        "id": "test-app",
        "name": "Test Application",
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
        "wait_for": ".page-ready",
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

TOOL_YAML = {
    "tool": {
        "name": "add_item",
        "description": "Add a new item",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Item text"},
            },
            "required": ["text"],
        },
        "bridge": {
            "page": "test_page",
            "steps": [
                {"navigate": {"page": "test_page"}},
                {
                    "interact": {
                        "field": "test_page.fields.name_input",
                        "action": "fill",
                        "value": "{{text}}",
                    }
                },
                {
                    "interact": {
                        "action": "click",
                        "target": "test_page.fields.submit_btn",
                    }
                },
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


@pytest.fixture
def semantic_dir() -> str:
    """Create a temporary directory with semantic YAML files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Write app.yaml
        with open(os.path.join(tmpdir, "app.yaml"), "w") as f:
            yaml.dump(APP_YAML, f)

        # Write pages/
        pages_dir = os.path.join(tmpdir, "pages")
        os.makedirs(pages_dir)
        with open(os.path.join(pages_dir, "test_page.yaml"), "w") as f:
            yaml.dump(PAGE_YAML, f)

        # Write tools/
        tools_dir = os.path.join(tmpdir, "tools")
        os.makedirs(tools_dir)
        with open(os.path.join(tools_dir, "add_item.yaml"), "w") as f:
            yaml.dump(TOOL_YAML, f)

        yield tmpdir


@pytest.fixture
def mock_driver() -> MagicMock:
    driver = MagicMock()
    driver.goto = MagicMock()
    driver.wait_for = MagicMock()
    driver.find_element = MagicMock(return_value=MagicMock())
    driver.click = MagicMock()
    driver.type_text = MagicMock()
    driver.read_text = MagicMock(return_value="mock result")
    driver.read_pattern = MagicMock(return_value=None)
    driver.evaluate = MagicMock()
    driver.screenshot = MagicMock(return_value=b"\x89PNG")
    return driver


# ─── Initialization Tests ─────────────────────────────────


class TestBridgeInit:
    def test_init_with_valid_config(self, semantic_dir: str, mock_driver: MagicMock) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        assert bridge is not None

    def test_loads_app_definition(self, semantic_dir: str, mock_driver: MagicMock) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        app = bridge.get_app("test-app")
        assert app is not None
        assert app["name"] == "Test Application"
        assert app["base_url"] == "http://localhost:3000"

    def test_loads_page_definition(self, semantic_dir: str, mock_driver: MagicMock) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        page = bridge.get_page("test_page")
        assert page is not None
        assert page["app"] == "test-app"
        assert len(page["fields"]) == 2

    def test_loads_tool_definition(self, semantic_dir: str, mock_driver: MagicMock) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        tool = bridge.get_tool("add_item")
        assert tool is not None
        assert tool["description"] == "Add a new item"

    def test_init_without_driver(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        # Should work for schema-only mode
        schemas = bridge.get_tool_schemas()
        assert len(schemas) == 1

    def test_invalid_semantic_path_raises(self) -> None:
        config = BridgeConfig(semantic_path="/nonexistent/path")
        with pytest.raises(FileNotFoundError):
            Bridge(config=config)


# ─── Tool Schema Tests ────────────────────────────────────


class TestGetToolSchemas:
    def test_returns_schemas(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        schemas = bridge.get_tool_schemas()
        assert len(schemas) == 1
        schema = schemas[0]
        assert schema["name"] == "add_item"
        assert schema["description"] == "Add a new item"
        assert "inputSchema" in schema

    def test_schema_has_correct_input_schema(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        schemas = bridge.get_tool_schemas()
        input_schema = schemas[0]["inputSchema"]
        assert input_schema["type"] == "object"
        assert "text" in input_schema["properties"]
        assert input_schema["required"] == ["text"]


# ─── Tool Execution Tests ─────────────────────────────────


class TestExecute:
    def test_execute_tool_navigates(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        bridge.execute("add_item", {"text": "Buy milk"})
        mock_driver.goto.assert_called_once_with("http://localhost:3000/")

    def test_execute_tool_waits_for_page(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        bridge.execute("add_item", {"text": "Buy milk"})
        mock_driver.wait_for.assert_called()

    def test_execute_tool_types_text(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        bridge.execute("add_item", {"text": "Buy milk"})
        mock_driver.type_text.assert_called_once()
        # Check the text value passed
        call_args = mock_driver.type_text.call_args
        assert call_args[0][1] == "Buy milk"

    def test_execute_tool_clicks_button(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        bridge.execute("add_item", {"text": "Buy milk"})
        mock_driver.click.assert_called_once()

    def test_execute_tool_captures_output(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        result = bridge.execute("add_item", {"text": "Buy milk"})
        assert "result" in result
        assert result["result"] == "mock result"

    def test_execute_unknown_tool_raises(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        with pytest.raises(KeyError, match="Tool not found"):
            bridge.execute("nonexistent_tool", {})

    def test_execute_without_driver_raises(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        with pytest.raises(RuntimeError, match="No driver"):
            bridge.execute("add_item", {"text": "test"})

    def test_execute_with_wait_step(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        """Test tool with an explicit wait step."""
        # Create a tool with a wait step
        tool_with_wait = {
            "tool": {
                "name": "wait_tool",
                "description": "A tool that waits",
                "inputSchema": {"type": "object", "properties": {}, "required": []},
                "bridge": {
                    "page": "test_page",
                    "steps": [
                        {"navigate": {"page": "test_page"}},
                        {"wait": 500},
                    ],
                },
            }
        }
        tools_dir = os.path.join(semantic_dir, "tools")
        with open(os.path.join(tools_dir, "wait_tool.yaml"), "w") as f:
            yaml.dump(tool_with_wait, f)

        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        result = bridge.execute("wait_tool", {})
        # Wait should have been called for timeout
        wait_calls = mock_driver.wait_for.call_args_list
        found_timeout = any(
            c[0][0].get("type") == "timeout" and c[0][0].get("value") == 500
            for c in wait_calls
        )
        assert found_timeout

    def test_execute_with_evaluate_js_step(
        self, semantic_dir: str, mock_driver: MagicMock
    ) -> None:
        """Test tool with evaluate_js step."""
        tool_with_js = {
            "tool": {
                "name": "js_tool",
                "description": "A tool with JS eval",
                "inputSchema": {"type": "object", "properties": {}, "required": []},
                "bridge": {
                    "page": "test_page",
                    "steps": [
                        {"navigate": {"page": "test_page"}},
                        {"evaluate_js": "document.title"},
                    ],
                },
            }
        }
        tools_dir = os.path.join(semantic_dir, "tools")
        with open(os.path.join(tools_dir, "js_tool.yaml"), "w") as f:
            yaml.dump(tool_with_js, f)

        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config, driver=mock_driver)
        bridge.execute("js_tool", {})
        mock_driver.evaluate.assert_called_once_with("document.title")


# ─── Field/Output Resolution Tests ────────────────────────


class TestResolution:
    def test_resolve_field_ref(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        field = bridge.resolve_field_ref("test_page.fields.name_input")
        assert field is not None
        assert field["id"] == "name_input"

    def test_resolve_output_ref(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        output = bridge.resolve_output_ref("test_page.outputs.result_text")
        assert output is not None
        assert output["id"] == "result_text"

    def test_resolve_unknown_field_returns_none(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        result = bridge.resolve_field_ref("test_page.fields.unknown")
        assert result is None

    def test_resolve_unknown_output_returns_none(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        result = bridge.resolve_output_ref("test_page.outputs.unknown")
        assert result is None


# ─── Template Rendering Tests ─────────────────────────────


class TestTemplateRendering:
    def test_renders_simple_variable(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        result = bridge._render_template("Hello {{name}}", {"name": "World"})
        assert result == "Hello World"

    def test_renders_nested_variable(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        result = bridge._render_template(
            "{{app.base_url}}/", {"app": {"base_url": "http://localhost:3000"}}
        )
        assert result == "http://localhost:3000/"

    def test_renders_missing_variable_as_empty(self, semantic_dir: str) -> None:
        config = BridgeConfig(semantic_path=semantic_dir)
        bridge = Bridge(config=config)
        result = bridge._render_template("Hello {{missing}}", {})
        assert result == "Hello "
