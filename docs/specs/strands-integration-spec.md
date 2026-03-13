# Strands Agents Integration Specification

## Purpose

The Strands integration enables WebMCP Bridge tools to be used as native Strands agent tools. It provides utilities to convert bridge tool definitions into Strands-compatible tool descriptors and to create agents with bridge tools automatically registered.

**Key responsibilities:**
- Convert bridge ToolDefinition to Strands @tool-decorated Python function
- Create Strands Agent with bridge tools attached
- Handle model provider mapping (bedrock, anthropic, openai)
- Provide system prompt with tool summary
- Enable structured tool calling from agents

## Data Structures

```python
# ─── Strands Integration Module ──────────────────────────

from strands import Agent, Tool, AnthropicModel, BedrockModel, OpenAIModel

class BridgeToolsIntegration:
    def __init__(self, bridge: BridgeClient):
        self.bridge = bridge

    def create_bridge_tools(self) -> List[Tool]:
        """Convert all bridge tools to Strands tools"""
        return [...]

    def create_bridge_agent(
        self,
        model_provider: str,  # 'bedrock', 'anthropic', 'openai'
        model_id: str,        # e.g., 'claude-opus-4-6'
        tools: Optional[List[Tool]] = None
    ) -> Agent:
        """Create Strands Agent with bridge tools"""
        return Agent(...)
```

## Algorithm: create_bridge_tools()

**Inputs:**
- Bridge instance with loaded tools from SemanticStore

**Outputs:**
- `List[Tool]` — list of Strands-decorated Python functions

**Pseudocode:**

```python
def create_bridge_tools(self) -> List[Tool]:
    """Convert all bridge tool definitions to Strands @tool functions"""

    tools = []

    # Get all tool schemas from bridge
    tool_schemas = self.bridge.get_tool_schemas()

    for tool_schema in tool_schemas:
        name = tool_schema.name
        description = tool_schema.description
        input_schema = tool_schema.inputSchema  # JSON Schema
        tool_def = tool_schema  # Full ToolDefinition

        # Create a function signature matching inputSchema
        # E.g., if inputSchema has properties {name: string, email: string}
        # Create: def tool_name(name: str, email: str) -> Dict

        # Step 1: Parse JSON Schema to extract parameters
        properties = input_schema.get('properties', {})
        required = input_schema.get('required', [])

        # Build parameter list
        parameters = []
        type_hints = {}
        defaults = {}

        for param_name, param_schema in properties.items():
            param_type = param_schema.get('type', 'string')
            param_desc = param_schema.get('description', '')

            # Map JSON Schema type to Python type
            python_type = map_json_type_to_python(param_type)
            type_hints[param_name] = python_type

            # Check if required or has default
            if param_name not in required:
                defaults[param_name] = None

            parameters.append((param_name, python_type, param_desc))

        # Step 2: Create tool function dynamically
        async def tool_function(**kwargs):
            """
            Docstring: [tool.description]
            """
            # Call bridge.execute_tool(name, kwargs)
            result = await self.bridge.execute_tool(name, kwargs)

            if result.ok:
                return result.outputs
            else:
                raise Exception(f"Tool execution failed: {result.error}")

        # Set metadata
        tool_function.__name__ = name
        tool_function.__doc__ = f"{description}\n\nParameters:\n"
        for param_name, param_type, param_desc in parameters:
            tool_function.__doc__ += f"  {param_name} ({param_type}): {param_desc}\n"

        # Decorate with @tool
        strands_tool = tool(
            name=name,
            description=description,
            parameters=build_strands_parameter_schema(properties, required)
        )(tool_function)

        tools.append(strands_tool)

    return tools

def map_json_type_to_python(json_type: str) -> type:
    """Map JSON Schema type to Python type hint"""
    mapping = {
        'string': str,
        'number': float,
        'integer': int,
        'boolean': bool,
        'array': list,
        'object': dict,
        'null': type(None)
    }
    return mapping.get(json_type, str)

def build_strands_parameter_schema(properties: Dict, required: List[str]) -> Dict:
    """Build Strands-compatible parameter schema"""
    return {
        'type': 'object',
        'properties': properties,
        'required': required
    }
```

## Algorithm: create_bridge_agent(model_provider, model_id, tools?)

**Inputs:**
- `model_provider: str` — 'bedrock', 'anthropic', 'openai'
- `model_id: str` — model identifier (e.g., 'claude-opus-4-6')
- `tools?: List[Tool]` — optional pre-created tools (defaults to all bridge tools)

**Outputs:**
- `Agent` — initialized Strands Agent

**Pseudocode:**

```python
def create_bridge_agent(
    self,
    model_provider: str,
    model_id: str,
    tools: Optional[List[Tool]] = None
) -> Agent:
    """Create Strands agent with bridge tools"""

    # Step 1: Map model provider to Strands model class
    if model_provider == 'bedrock':
        from strands import BedrockModel
        model = BedrockModel(model_id=model_id)

    elif model_provider == 'anthropic':
        from strands import AnthropicModel
        model = AnthropicModel(model_id=model_id)

    elif model_provider == 'openai':
        from strands import OpenAIModel
        model = OpenAIModel(model_id=model_id)

    else:
        raise ValueError(f"Unknown model provider: {model_provider}")

    # Step 2: Use provided tools or create from bridge
    if tools is None:
        tools = self.create_bridge_tools()

    # Step 3: Build system prompt
    tool_names = [t.name for t in tools]
    system_prompt = f"""You are an assistant that can use web automation tools.

Available tools:
{', '.join(tool_names)}

Use these tools to help the user accomplish their tasks. Always use structured tool calls with the tool names and parameters specified above."""

    # Step 4: Create and return agent
    agent = Agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        max_iterations=10,  # Max tool calls before stopping
        verbose=True
    )

    return agent
```

## Model Provider Mapping

| Provider | Class | Environment | Notes |
|----------|-------|-------------|-------|
| `bedrock` | `BedrockModel` | AWS credentials | Requires AWS SDK |
| `anthropic` | `AnthropicModel` | `ANTHROPIC_API_KEY` | Direct API |
| `openai` | `OpenAIModel` | `OPENAI_API_KEY` | Direct API |

## Example Usage

```python
from strands_integration import BridgeToolsIntegration
from bridge import BridgeClient

# Initialize bridge
bridge = BridgeClient(yaml_dir='/path/to/apps')
bridge.load_semantic_store()

# Create integration
integration = BridgeToolsIntegration(bridge)

# Create tools
tools = integration.create_bridge_tools()

# Create agent with Anthropic model
agent = integration.create_bridge_agent(
    model_provider='anthropic',
    model_id='claude-opus-4-6',
    tools=tools
)

# Use agent
result = agent.run("Create a new todo item with title 'Buy milk'")
```

## System Prompt Template

```
You are an assistant that can use web automation tools to interact with web applications.

Available tools:
[tool_name_1]: [tool_description_1]
[tool_name_2]: [tool_description_2]
...

Instructions:
1. When the user asks you to perform a task, identify which tool(s) are needed
2. Use structured tool calls with exact parameter names and types
3. Provide input parameters based on the user's request
4. After tool execution, inform the user of the result
5. If a tool fails, try alternative approaches or explain what went wrong

Tool Calling Format:
For each tool call, provide:
- Tool name (exact match from Available tools list)
- Parameters as key-value pairs (matching inputSchema)

Example:
Tool: create_todo
Parameters:
  title: "Buy milk"
  description: "At the grocery store"
```

## Integration Constraints

1. **Async/Await:** Strands expects async functions. Bridge client should support async execution.

2. **Parameter Mapping:** JSON Schema parameters must map to Python function arguments exactly.

3. **Return Values:** Tool functions should return plain dictionaries or JSON-serializable objects.

4. **Error Handling:** Tool execution errors should be raised as exceptions (Strands expects this).

5. **Tool Naming:** Tool names must be URL-safe (lowercase, underscores only) to comply with Strands.

6. **Docstrings:** Tool docstrings are used by Strands for display and documentation.

## Test Scenarios

### 1. Convert single bridge tool to Strands tool

**Setup:** Bridge with tool "create_todo" with inputSchema: { name: string, description: string }

**Test:** `integration.create_bridge_tools()`

**Expected:** List with one Tool, tool.name == "create_todo", callable with (name, description)

### 2. Create agent with Anthropic model

**Setup:** Integration, model_provider='anthropic'

**Test:** `integration.create_bridge_agent('anthropic', 'claude-opus-4-6')`

**Expected:** Agent created, has tools attached, can call agent.run()

### 3. Create agent with Bedrock model

**Setup:** Integration, AWS credentials available

**Test:** `integration.create_bridge_agent('bedrock', 'anthropic.claude-3-sonnet-20240229-v1:0')`

**Expected:** Agent created with BedrockModel

### 4. Unknown model provider

**Setup:** Integration

**Test:** `integration.create_bridge_agent('unknown', 'model-id')`

**Expected:** ValueError raised

### 5. Tool execution success

**Setup:** Agent with tools, bridge returns ok result

**Test:** Agent calls tool

**Expected:** Tool returns outputs dict, agent continues

### 6. Tool execution failure

**Setup:** Agent with tools, bridge returns error

**Test:** Agent calls tool

**Expected:** Tool raises exception, agent can retry or explain error

### 7. Multiple tools available

**Setup:** Bridge with 3 tools (create_todo, update_todo, delete_todo)

**Test:** `integration.create_bridge_tools()`

**Expected:** List of 3 Strands tools, all callable

### 8. Tool with complex schema

**Setup:** Bridge tool with nested/array parameters

**Test:** `integration.create_bridge_tools()`

**Expected:** Tool created with correct parameter schema

### 9. System prompt includes all tools

**Setup:** Agent creation

**Test:** Check agent.system_prompt

**Expected:** Contains list of all tool names and descriptions

### 10. Tool parameter types mapped correctly

**Setup:** Tool with string, number, boolean parameters

**Test:** Call tool with correct types

**Expected:** Parameters passed to bridge correctly
