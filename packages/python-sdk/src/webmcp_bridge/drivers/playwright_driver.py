"""
PlaywrightDriver — Python implementation of BridgeDriver using Playwright.

Maps bridge operations to Playwright's sync API:
- find_element → page.locator() with strategy-based selectors
- click → locator.click()
- type_text → locator.fill()
- read_text → locator.text_content()
- screenshot → page.screenshot()

Implementation notes for agents:
- Constructor takes a Playwright Page (sync), Browser, and BrowserContext
- ARIA strategy → page.get_by_role(role, name=name)
- Label strategy → page.get_by_label(text)
- Text strategy → page.get_by_text(text)
- CSS strategy → page.locator(selector)
- JS strategy → page.evaluate(expression)
"""
from __future__ import annotations

import re
from typing import Any


def _escape_regex(s: str) -> str:
    """Escape special regex characters in a string."""
    return re.escape(s)


class PlaywrightDriver:
    """Playwright-based BridgeDriver implementation."""

    def __init__(
        self,
        page: Any,
        browser: Any | None = None,
        context: Any | None = None,
        timeout: int = 30000,
    ) -> None:
        self._page = page
        self._browser = browser
        self._context = context
        self._timeout = timeout
        self._named_pages: dict[str, Any] = {}

    # ─── Navigation ────────────────────────────────────

    def goto(self, url: str) -> None:
        """Navigate to URL."""
        self._page.goto(url, wait_until="domcontentloaded")

    def wait_for_navigation(self, url_pattern: str | None = None) -> None:
        """Wait for navigation to complete."""
        if url_pattern:
            self._page.wait_for_url(url_pattern, timeout=self._timeout)
        else:
            self._page.wait_for_load_state("domcontentloaded", timeout=self._timeout)

    # ─── Element Finding ──────────────────────────────

    def find_element(self, selectors: list[dict[str, Any]]) -> Any:
        """Find element using selector chain with strategy fallback."""
        for strategy in selectors:
            try:
                locator = self._map_strategy_to_locator(strategy)
                if locator is None:
                    continue
                locator.first.wait_for(state="attached", timeout=5000)
                return locator.first
            except Exception:
                continue
        raise RuntimeError("Failed to find element with any strategy")

    def _map_strategy_to_locator(self, strategy: dict[str, Any]) -> Any:
        """Map a selector strategy to a Playwright locator."""
        kind = strategy["strategy"]

        if kind == "css":
            return self._page.locator(strategy["selector"])

        if kind == "aria":
            name = strategy.get("name")
            name_pattern = (
                re.compile(_escape_regex(name), re.IGNORECASE) if name else None
            )
            return self._page.get_by_role(strategy["role"], name=name_pattern)

        if kind == "label":
            text_pattern = re.compile(_escape_regex(strategy["text"]), re.IGNORECASE)
            return self._page.get_by_label(text_pattern)

        if kind == "text":
            if strategy.get("exact"):
                return self._page.get_by_text(strategy["text"], exact=True)
            text_pattern = re.compile(_escape_regex(strategy["text"]), re.IGNORECASE)
            return self._page.get_by_text(text_pattern)

        if kind == "js":
            element = self._page.evaluate(strategy["expression"])
            if element:
                return element
            return None

        msg = f"Unknown selector strategy: {kind}"
        raise ValueError(msg)

    # ─── Interactions ─────────────────────────────────

    def click(self, element: Any) -> None:
        """Click element."""
        element.click(timeout=self._timeout)

    def double_click(self, element: Any) -> None:
        """Double-click element."""
        element.dblclick(timeout=self._timeout)

    def type_text(
        self,
        element: Any,
        text: str,
        clear: bool = False,
        delay: int | None = None,
    ) -> None:
        """Type text into element."""
        if clear:
            element.clear()
        if delay:
            element.press_sequentially(text, delay=delay)
        else:
            element.fill(text)

    def select(self, element: Any, value: str) -> None:
        """Select option from dropdown."""
        element.select_option(value)

    def check(self, element: Any, state: bool) -> None:
        """Check or uncheck a checkbox."""
        if state:
            element.check(timeout=self._timeout)
        else:
            element.uncheck(timeout=self._timeout)

    def clear(self, element: Any) -> None:
        """Clear element value."""
        element.clear()

    def hover(self, element: Any) -> None:
        """Hover over element."""
        element.hover(timeout=self._timeout)

    def drag_drop(self, source: Any, target: Any) -> None:
        """Drag source element to target element."""
        source.drag_to(target)

    def upload_file(self, element: Any, paths: list[str]) -> None:
        """Upload files to input element."""
        element.set_input_files(paths)

    # ─── Reading ──────────────────────────────────────

    def read_text(self, selectors: list[dict[str, Any]]) -> str:
        """Read text from element found by selectors."""
        element = self.find_element(selectors)
        text = element.text_content()
        return (text or "").strip()

    def read_pattern(
        self, selectors: list[dict[str, Any]], regex: str
    ) -> str | None:
        """Read text and match a regex pattern."""
        text = self.read_text(selectors)
        pattern = re.compile(regex)
        match = pattern.search(text)
        if not match:
            return None
        return match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)

    # ─── Keyboard ─────────────────────────────────────

    def press_key(self, key: str, modifiers: list[str] | None = None) -> None:
        """Press a keyboard key with optional modifiers."""
        if modifiers:
            combo = "+".join(modifiers) + "+" + key
        else:
            combo = key
        self._page.keyboard.press(combo)

    def press_sequentially(
        self, element: Any, text: str, delay: int | None = None
    ) -> None:
        """Type text character by character."""
        element.press_sequentially(text, delay=delay)

    # ─── Scrolling ────────────────────────────────────

    def scroll(
        self,
        target: Any | str | None = None,
        behavior: str = "instant",
    ) -> None:
        """Scroll page or element into view."""
        if isinstance(target, str) and target == "top":
            self._page.evaluate(f"window.scrollTo({{ top: 0, behavior: '{behavior}' }})")
        elif isinstance(target, str) and target == "bottom":
            self._page.evaluate(
                f"window.scrollTo({{ top: document.body.scrollHeight, behavior: '{behavior}' }})"
            )
        elif target is not None and not isinstance(target, str):
            target.scroll_into_view_if_needed(timeout=self._timeout)
        else:
            self._page.evaluate(f"window.scrollTo({{ top: 0, behavior: '{behavior}' }})")

    # ─── Overlays ─────────────────────────────────────

    def dismiss_overlay(self, strategy: dict[str, Any]) -> bool:
        """Try to dismiss an overlay using the given strategy."""
        try:
            overlay_type = strategy["type"]
            if overlay_type == "press_escape":
                self._page.keyboard.press("Escape")
            elif overlay_type == "click_close":
                selector = strategy.get("selector")
                if selector:
                    self._page.locator(selector).click(timeout=3000)
            elif overlay_type == "click_text":
                texts = strategy.get("text", [])
                for t in texts:
                    try:
                        self._page.get_by_text(t, exact=False).click(timeout=2000)
                        break
                    except Exception:
                        continue
            elif overlay_type == "remove_element":
                selector = strategy.get("selector")
                if selector:
                    self._page.evaluate(
                        f"document.querySelector('{selector}')?.remove()"
                    )

            wait_after = strategy.get("waitAfter")
            if wait_after:
                self._page.wait_for_timeout(wait_after)
            return True
        except Exception:
            return False

    # ─── Events ───────────────────────────────────────

    def dispatch_event(
        self, element: Any, event: str, detail: Any | None = None
    ) -> None:
        """Dispatch a DOM event on an element."""
        event_init = {"detail": detail} if detail else None
        element.dispatch_event(event, event_init)

    # ─── Dialogs ──────────────────────────────────────

    def handle_dialog(
        self, action: str, prompt_text: str | None = None
    ) -> str:
        """Handle a JavaScript dialog (alert/confirm/prompt)."""
        message = ""

        def on_dialog(dialog: Any) -> None:
            nonlocal message
            message = dialog.message
            if action == "accept":
                dialog.accept(prompt_text)
            else:
                dialog.dismiss()

        self._page.once("dialog", on_dialog)
        return message

    # ─── Waiting ──────────────────────────────────────

    def wait_for(self, condition: dict[str, Any]) -> None:
        """Wait for a condition to be met."""
        cond_type = condition["type"]
        value = condition.get("value")
        timeout = condition.get("timeout", self._timeout)

        if cond_type == "selector":
            self._page.locator(value).wait_for(state="visible", timeout=timeout)
        elif cond_type == "url":
            self._page.wait_for_url(value, timeout=timeout)
        elif cond_type == "timeout":
            self._page.wait_for_timeout(value)
        elif cond_type == "network_idle":
            self._page.wait_for_load_state("networkidle", timeout=timeout)
        else:
            msg = f"Unknown wait condition type: {cond_type}"
            raise ValueError(msg)

    # ─── Diagnostics ──────────────────────────────────

    def screenshot(self) -> bytes:
        """Take a full-page screenshot."""
        return self._page.screenshot(full_page=True)  # type: ignore[no-any-return]

    def evaluate(self, js: str) -> Any:
        """Evaluate JavaScript in the page context."""
        return self._page.evaluate(js)

    # ─── Context ──────────────────────────────────────

    def get_page_context(self) -> dict[str, Any]:
        """Get current page context information."""
        return {
            "url": self._page.url,
            "title": self._page.title(),
            "readyState": self._page.evaluate("document.readyState"),
        }

    # ─── Multi-tab ────────────────────────────────────

    def get_named_page(self, name: str) -> Any:
        """Get a previously created named page."""
        if name not in self._named_pages:
            msg = f"Page not found: {name}"
            raise RuntimeError(msg)
        page = self._named_pages[name]
        page.bring_to_front()
        return page

    def create_page(self, name: str) -> Any:
        """Create a new named page/tab."""
        if self._context is None:
            msg = "No browser context available"
            raise RuntimeError(msg)
        page = self._context.new_page()
        self._named_pages[name] = page
        return page

    # ─── Legacy compatibility ─────────────────────────

    def wait_for_selector(self, selector: str, timeout: int = 10000) -> None:
        """Wait for a CSS selector to be visible (legacy method)."""
        self.wait_for({"type": "selector", "value": selector, "timeout": timeout})
