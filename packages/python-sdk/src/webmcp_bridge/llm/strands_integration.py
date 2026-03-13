"""
Strands Agents integration — expose bridge tools as Strands-compatible callables.

This module:
1. Takes a Bridge instance
2. Reads all tool schemas from the semantic store
3. Generates @tool decorated functions for each bridge tool
4. Creates a Strands Agent with those tools pre-loaded
5. The agent can then receive NLP commands and route them to bridge tools

Usage:
    from webmcp_bridge import Bridge, BridgeConfig
    from webmcp_bridge.llm import create_bridge_agent

    bridge = Bridge(config=BridgeConfig(semantic_path="./semantic"), driver=driver)
    agent = create_bridge_agent(bridge, model_id="us.anthropic.claude-sonnet-4-20250514-v1:0")

    result = agent("Update the status of ticket 12345 to resolved")
    # Agent plans: call update_ticket_status(id="12345", status="resolved")
    # Bridge executes the tool against the live app
    # Returns captured outputs

Implementation notes for agents:
- Use strands.Agent for agent creation
- Use @strands.tool decorator pattern for dynamic tool generation
- Each bridge tool becomes a Strands tool with:
  - Name from tool definition
  - Description from tool definition
  - Parameters from inputSchema
  - Return type from outputSchema
- The tool's body calls bridge.execute(tool_name, inputs)
- Model provider is configurable (Bedrock, Anthropic, OpenAI, Ollama, etc.)
"""
from __future__ import annotations

from typing import Any

from strands import Agent
from strands.tools import tool


def create_bridge_tools(bridge: Any) -> list[Any]:
    """
    Generate Strands @tool callables from all bridge tool definitions.

    Each generated tool:
    - Has the tool's name, description, and parameter schema
    - When called, executes bridge.execute(name, params)
    - Returns the captured outputs dict
    """
    tool_schemas = bridge.get_tool_schemas()
    tools = []

    for schema in tool_schemas:
        tool_name = schema["name"]
        tool_description = schema["description"]
        tool_input_schema = schema["inputSchema"]

        # Create a closure to capture tool_name for each tool
        def _make_tool_fn(name: str) -> Any:
            def tool_fn(**kwargs: Any) -> dict[str, Any]:
                """Execute the bridge tool and return outputs."""
                return bridge.execute(name, kwargs)

            tool_fn.__name__ = name
            tool_fn.__qualname__ = name
            return tool_fn

        fn = _make_tool_fn(tool_name)

        # Decorate with @tool
        decorated = tool(
            fn,
            name=tool_name,
            description=tool_description,
            inputSchema=tool_input_schema,
        )

        tools.append(decorated)

    return tools


def create_bridge_agent(
    bridge: Any,
    model_provider: str = "bedrock",
    model_id: str = "us.anthropic.claude-sonnet-4-20250514-v1:0",
    system_prompt: str | None = None,
) -> Any:
    """
    Create a Strands Agent pre-loaded with all bridge tools.

    The agent can receive NLP commands and automatically route them
    to the appropriate bridge tool based on the command intent.
    """
    # Create model based on provider
    model = _create_model(model_provider, model_id)

    # Generate bridge tools
    tools = create_bridge_tools(bridge)

    # Build system prompt if not provided
    if system_prompt is None:
        tool_schemas = bridge.get_tool_schemas()
        tool_lines = [f"- {s['name']}: {s['description']}" for s in tool_schemas]
        system_prompt = (
            "You are an assistant that can use web automation tools to interact "
            "with web applications.\n\n"
            "Available tools:\n"
            + "\n".join(tool_lines)
            + "\n\n"
            "Instructions:\n"
            "1. When the user asks you to perform a task, identify which tool(s) are needed\n"
            "2. Use structured tool calls with exact parameter names and types\n"
            "3. Provide input parameters based on the user's request\n"
            "4. After tool execution, inform the user of the result\n"
            "5. If a tool fails, try alternative approaches or explain what went wrong"
        )

    return Agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
    )


def _create_model(provider: str, model_id: str) -> Any:
    """Create a Strands model instance from provider name."""
    if provider == "bedrock":
        from strands.models.bedrock import BedrockModel
        return BedrockModel(model_id=model_id)

    if provider == "anthropic":
        from strands.models.anthropic import AnthropicModel
        return AnthropicModel(model_id=model_id)

    if provider == "openai":
        from strands.models.openai import OpenAIModel
        return OpenAIModel(model_id=model_id)

    if provider == "ollama":
        from strands.models.ollama import OllamaModel
        return OllamaModel(model_id=model_id)

    msg = f"Unknown model provider: {provider}"
    raise ValueError(msg)
