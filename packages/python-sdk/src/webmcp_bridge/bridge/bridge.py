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
- Provides execute(tool_name, inputs) -> dict of captured outputs
- Provides execute_workflow(name, inputs) -> dict
- Provides get_tool_schemas() -> list for LLM function calling
- Provides get_strands_tools() -> list of @tool decorated callables for Strands Agent
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml

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

        # Semantic store
        self._apps: dict[str, dict[str, Any]] = {}
        self._pages: dict[str, dict[str, Any]] = {}
        self._tools: dict[str, dict[str, Any]] = {}
        self._workflows: dict[str, dict[str, Any]] = {}

        # Load semantic definitions
        self._load_semantic_store()

    # ─── Semantic Store ────────────────────────────────

    def _load_semantic_store(self) -> None:
        """Load all YAML definitions from the semantic path."""
        sem_path = Path(self._config.semantic_path)
        if not sem_path.exists():
            msg = f"Semantic path not found: {sem_path}"
            raise FileNotFoundError(msg)

        # Load app.yaml
        app_file = sem_path / "app.yaml"
        if app_file.exists():
            with open(app_file) as f:
                data = yaml.safe_load(f)
            if data and "app" in data:
                app_def = data["app"]
                self._apps[app_def["id"]] = app_def

        # Load pages/*.yaml
        pages_dir = sem_path / "pages"
        if pages_dir.exists():
            for page_file in sorted(pages_dir.glob("*.yaml")):
                with open(page_file) as f:
                    data = yaml.safe_load(f)
                if data and "page" in data:
                    page_def = data["page"]
                    self._pages[page_def["id"]] = page_def

        # Load tools/*.yaml
        tools_dir = sem_path / "tools"
        if tools_dir.exists():
            for tool_file in sorted(tools_dir.glob("*.yaml")):
                with open(tool_file) as f:
                    data = yaml.safe_load(f)
                if data and "tool" in data:
                    tool_def = data["tool"]
                    self._tools[tool_def["name"]] = tool_def

        # Load workflows/*.yaml
        workflows_dir = sem_path / "workflows"
        if workflows_dir.exists():
            for wf_file in sorted(workflows_dir.glob("*.yaml")):
                with open(wf_file) as f:
                    data = yaml.safe_load(f)
                if data and "workflow" in data:
                    wf_def = data["workflow"]
                    self._workflows[wf_def["name"]] = wf_def

    # ─── Getters ──────────────────────────────────────

    def get_app(self, app_id: str) -> dict[str, Any] | None:
        """Get app definition by ID."""
        return self._apps.get(app_id)

    def get_page(self, page_id: str) -> dict[str, Any] | None:
        """Get page definition by ID."""
        return self._pages.get(page_id)

    def get_tool(self, tool_name: str) -> dict[str, Any] | None:
        """Get tool definition by name."""
        return self._tools.get(tool_name)

    # ─── Resolution ───────────────────────────────────

    def resolve_field_ref(self, ref: str) -> dict[str, Any] | None:
        """Resolve a field reference like 'page_id.fields.field_id'."""
        parts = ref.split(".")
        if len(parts) < 3 or parts[1] != "fields":
            return None
        page_id = parts[0]
        field_id = parts[2]
        page = self._pages.get(page_id)
        if not page:
            return None
        for field in page.get("fields", []):
            if field["id"] == field_id:
                return field
        return None

    def resolve_output_ref(self, ref: str) -> dict[str, Any] | None:
        """Resolve an output reference like 'page_id.outputs.output_id'."""
        parts = ref.split(".")
        if len(parts) < 3 or parts[1] != "outputs":
            return None
        page_id = parts[0]
        output_id = parts[2]
        page = self._pages.get(page_id)
        if not page:
            return None
        for output in page.get("outputs", []):
            if output["id"] == output_id:
                return output
        return None

    # ─── Template Rendering ───────────────────────────

    def _render_template(self, template: str, variables: dict[str, Any]) -> str:
        """Render a {{variable}} template with given variables."""

        def replacer(match: re.Match[str]) -> str:
            expr = match.group(1).strip()
            # Support nested access: app.base_url
            parts = expr.split(".")
            value: Any = variables
            for part in parts:
                if isinstance(value, dict):
                    value = value.get(part)
                else:
                    return ""
                if value is None:
                    return ""
            return str(value)

        return re.sub(r"\{\{(.+?)\}\}", replacer, template)

    # ─── Tool Schemas ─────────────────────────────────

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        """Get all tool schemas for LLM function calling."""
        schemas = []
        for tool_def in self._tools.values():
            schemas.append({
                "name": tool_def["name"],
                "description": tool_def["description"],
                "inputSchema": tool_def["inputSchema"],
            })
        return schemas

    # ─── Tool Execution ───────────────────────────────

    def execute(self, tool_name: str, inputs: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool and return captured outputs."""
        if self._driver is None:
            msg = "No driver configured — cannot execute tools"
            raise RuntimeError(msg)

        tool_def = self._tools.get(tool_name)
        if tool_def is None:
            msg = f"Tool not found: {tool_name}"
            raise KeyError(msg)

        bridge = tool_def["bridge"]
        page_id = bridge["page"]
        page_def = self._pages.get(page_id)
        if page_def is None:
            msg = f"Page not found: {page_id}"
            raise KeyError(msg)

        # Build variable context
        variables: dict[str, Any] = dict(inputs)

        # Add app to variables
        app_id = page_def.get("app")
        if app_id:
            app = self._apps.get(app_id)
            if app:
                variables["app"] = app

        # Captured outputs
        outputs: dict[str, Any] = {}

        # Execute steps
        for step in bridge["steps"]:
            self._execute_step(step, variables, outputs, page_def)

        # Apply returns mapping
        if "returns" in bridge:
            final_outputs: dict[str, Any] = {}
            for key, template in bridge["returns"].items():
                final_outputs[key] = self._render_template(template, variables)
            return final_outputs

        return outputs

    def _execute_step(
        self,
        step: dict[str, Any],
        variables: dict[str, Any],
        outputs: dict[str, Any],
        current_page: dict[str, Any],
    ) -> None:
        """Execute a single tool step."""
        if "navigate" in step:
            self._execute_navigate(step["navigate"], variables, current_page)
        elif "interact" in step:
            self._execute_interact(step["interact"], variables)
        elif "capture" in step:
            self._execute_capture(step["capture"], variables, outputs)
        elif "wait" in step:
            self._execute_wait(step["wait"])
        elif "evaluate_js" in step:
            self._driver.evaluate(step["evaluate_js"])

    def _execute_navigate(
        self,
        navigate: dict[str, Any],
        variables: dict[str, Any],
        current_page: dict[str, Any],
    ) -> None:
        """Execute a navigate step."""
        page_id = navigate["page"]
        page_def = self._pages.get(page_id, current_page)

        url_template = page_def.get("url_template", page_def.get("url_pattern", "/"))
        url = self._render_template(url_template, variables)
        self._driver.goto(url)

        wait_for = page_def.get("wait_for")
        if wait_for:
            self._driver.wait_for({
                "type": "selector",
                "value": wait_for,
                "timeout": self._config.navigation_timeout_ms,
            })

    def _execute_interact(
        self,
        interact: dict[str, Any],
        variables: dict[str, Any],
    ) -> None:
        """Execute an interact step."""
        field_ref = interact.get("field") or interact.get("target")
        if not field_ref:
            return

        field_def = self.resolve_field_ref(field_ref)
        if not field_def:
            msg = f"Field not found: {field_ref}"
            raise KeyError(msg)

        # Find element
        element = self._driver.find_element(field_def["selectors"])

        # Determine action
        action = interact.get("action", field_def.get("interaction", {}).get("type", "click"))

        if action in ("fill", "type", "text_input"):
            value_template = interact.get("value", "")
            rendered_value = self._render_template(value_template, variables)
            self._driver.type_text(element, rendered_value)
        elif action == "click":
            self._driver.click(element)
        elif action == "select":
            value_template = interact.get("value", "")
            rendered_value = self._render_template(value_template, variables)
            self._driver.select(element, rendered_value)
        elif action == "check":
            self._driver.check(element, True)
        elif action == "clear":
            self._driver.clear(element)
        elif action == "hover":
            self._driver.hover(element)
        else:
            # Default to click for action buttons
            if field_def.get("type") == "action_button":
                self._driver.click(element)

    def _execute_capture(
        self,
        capture: dict[str, Any],
        variables: dict[str, Any],
        outputs: dict[str, Any],
    ) -> None:
        """Execute a capture step."""
        output_ref = capture["from"]
        store_as = capture["store_as"]

        if capture.get("wait"):
            self._driver.wait_for({"type": "timeout", "value": 500})

        output_def = self.resolve_output_ref(output_ref)
        if not output_def:
            msg = f"Output not found: {output_ref}"
            raise KeyError(msg)

        # Read text from element
        value = self._driver.read_text(output_def["selectors"])

        variables[store_as] = value
        outputs[store_as] = value

    def _execute_wait(self, wait: int | str) -> None:
        """Execute a wait step."""
        if isinstance(wait, int):
            duration_ms = wait
        elif isinstance(wait, str):
            duration_ms = self._parse_duration(wait)
        else:
            duration_ms = 1000
        self._driver.wait_for({"type": "timeout", "value": duration_ms})

    @staticmethod
    def _parse_duration(duration: str) -> int:
        """Parse a duration string like '500ms' or '2s' to milliseconds."""
        ms_match = re.match(r"^(\d+)\s*ms$", duration)
        if ms_match:
            return int(ms_match.group(1))
        s_match = re.match(r"^(\d+)\s*s$", duration)
        if s_match:
            return int(s_match.group(1)) * 1000
        try:
            return int(duration)
        except ValueError:
            return 5000

    # ─── Workflow Execution ───────────────────────────

    def execute_workflow(self, workflow_name: str, inputs: dict[str, Any]) -> dict[str, Any]:
        """Execute a workflow and return aggregated outputs."""
        wf = self._workflows.get(workflow_name)
        if wf is None:
            msg = f"Workflow not found: {workflow_name}"
            raise KeyError(msg)
        # Workflow execution is a future enhancement
        msg = "Workflow execution not yet implemented"
        raise NotImplementedError(msg)

    # ─── Strands Integration ──────────────────────────

    def get_strands_tools(self) -> list[Any]:
        """Get Strands Agent-compatible @tool callables for all loaded tools."""
        # Deferred to Issue #22
        from webmcp_bridge.llm.strands_integration import create_bridge_tools
        return create_bridge_tools(self)
