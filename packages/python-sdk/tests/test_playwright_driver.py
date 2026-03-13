"""Tests for PlaywrightDriver — Python implementation of BridgeDriver.

Uses unittest.mock to mock Playwright Page, Browser, BrowserContext objects.
Verifies all BridgeDriver methods delegate correctly to Playwright APIs.
"""
from __future__ import annotations

import re
from unittest.mock import MagicMock, PropertyMock, patch, call

import pytest

from webmcp_bridge.drivers.playwright_driver import PlaywrightDriver


# ─── Fixtures ──────────────────────────────────────────────


@pytest.fixture
def mock_page() -> MagicMock:
    page = MagicMock()
    page.url = "https://example.com/test"
    page.title.return_value = "Test Page"
    page.evaluate.return_value = "complete"
    return page


@pytest.fixture
def mock_browser() -> MagicMock:
    return MagicMock()


@pytest.fixture
def mock_context() -> MagicMock:
    return MagicMock()


@pytest.fixture
def driver(
    mock_page: MagicMock, mock_browser: MagicMock, mock_context: MagicMock
) -> PlaywrightDriver:
    return PlaywrightDriver(
        page=mock_page, browser=mock_browser, context=mock_context, timeout=10000
    )


# ─── Constructor ───────────────────────────────────────────


class TestConstructor:
    def test_stores_page(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        assert driver._page is mock_page

    def test_stores_browser(self, driver: PlaywrightDriver, mock_browser: MagicMock) -> None:
        assert driver._browser is mock_browser

    def test_stores_context(self, driver: PlaywrightDriver, mock_context: MagicMock) -> None:
        assert driver._context is mock_context

    def test_default_timeout(self, mock_page: MagicMock, mock_browser: MagicMock, mock_context: MagicMock) -> None:
        d = PlaywrightDriver(page=mock_page, browser=mock_browser, context=mock_context)
        assert d._timeout == 30000

    def test_custom_timeout(self, driver: PlaywrightDriver) -> None:
        assert driver._timeout == 10000


# ─── Navigation ────────────────────────────────────────────


class TestGoto:
    def test_navigates_to_url(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.goto("https://example.com")
        mock_page.goto.assert_called_once_with("https://example.com", wait_until="domcontentloaded")


class TestWaitForNavigation:
    def test_waits_for_url_pattern(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.wait_for_navigation("https://example.com/**")
        mock_page.wait_for_url.assert_called_once()

    def test_waits_for_load_state_without_pattern(
        self, driver: PlaywrightDriver, mock_page: MagicMock
    ) -> None:
        driver.wait_for_navigation()
        mock_page.wait_for_load_state.assert_called_once()


# ─── Element Finding ──────────────────────────────────────


class TestFindElement:
    def test_css_strategy(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        mock_page.locator.return_value = locator

        result = driver.find_element([{"strategy": "css", "selector": ".my-class"}])
        mock_page.locator.assert_called_once_with(".my-class")
        first.wait_for.assert_called_once()
        assert result is first

    def test_aria_strategy(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        mock_page.get_by_role.return_value = locator

        result = driver.find_element([{"strategy": "aria", "role": "button", "name": "Submit"}])
        mock_page.get_by_role.assert_called_once()
        assert result is first

    def test_label_strategy(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        mock_page.get_by_label.return_value = locator

        result = driver.find_element([{"strategy": "label", "text": "Email"}])
        mock_page.get_by_label.assert_called_once()
        assert result is first

    def test_text_strategy(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        mock_page.get_by_text.return_value = locator

        result = driver.find_element([{"strategy": "text", "text": "Hello"}])
        mock_page.get_by_text.assert_called_once()
        assert result is first

    def test_text_exact_strategy(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        mock_page.get_by_text.return_value = locator

        driver.find_element([{"strategy": "text", "text": "Hello", "exact": True}])
        mock_page.get_by_text.assert_called_once_with("Hello", exact=True)

    def test_fallback_to_second_strategy(
        self, driver: PlaywrightDriver, mock_page: MagicMock
    ) -> None:
        # First strategy fails
        bad_locator = MagicMock()
        bad_first = MagicMock()
        bad_locator.first = bad_first
        bad_first.wait_for.side_effect = Exception("Not found")
        mock_page.locator.return_value = bad_locator

        # Second strategy succeeds
        good_locator = MagicMock()
        good_first = MagicMock()
        good_locator.first = good_first
        mock_page.get_by_role.return_value = good_locator

        result = driver.find_element([
            {"strategy": "css", "selector": ".nonexistent"},
            {"strategy": "aria", "role": "button", "name": "Submit"},
        ])
        assert result is good_first

    def test_all_strategies_fail_raises(
        self, driver: PlaywrightDriver, mock_page: MagicMock
    ) -> None:
        bad_locator = MagicMock()
        bad_first = MagicMock()
        bad_locator.first = bad_first
        bad_first.wait_for.side_effect = Exception("Not found")
        mock_page.locator.return_value = bad_locator

        with pytest.raises(RuntimeError, match="Failed to find element"):
            driver.find_element([{"strategy": "css", "selector": ".nonexistent"}])


# ─── Interactions ──────────────────────────────────────────


class TestClick:
    def test_clicks_element(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.click(element)
        element.click.assert_called_once_with(timeout=10000)


class TestDoubleClick:
    def test_double_clicks_element(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.double_click(element)
        element.dblclick.assert_called_once_with(timeout=10000)


class TestTypeText:
    def test_fills_text(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.type_text(element, "hello")
        element.fill.assert_called_once_with("hello")

    def test_clears_before_filling(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.type_text(element, "hello", clear=True)
        element.clear.assert_called_once()
        element.fill.assert_called_once_with("hello")

    def test_types_with_delay(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.type_text(element, "hi", delay=100)
        element.press_sequentially.assert_called_once_with("hi", delay=100)


class TestSelect:
    def test_selects_option(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.select(element, "opt1")
        element.select_option.assert_called_once_with("opt1")


class TestCheck:
    def test_check_true(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.check(element, True)
        element.check.assert_called_once_with(timeout=10000)

    def test_check_false(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.check(element, False)
        element.uncheck.assert_called_once_with(timeout=10000)


class TestClear:
    def test_clears_element(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.clear(element)
        element.clear.assert_called_once()


class TestHover:
    def test_hovers_element(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.hover(element)
        element.hover.assert_called_once_with(timeout=10000)


class TestDragDrop:
    def test_drags_source_to_target(self, driver: PlaywrightDriver) -> None:
        source = MagicMock()
        target = MagicMock()
        driver.drag_drop(source, target)
        source.drag_to.assert_called_once_with(target)


class TestUploadFile:
    def test_sets_input_files(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.upload_file(element, ["/path/to/file.txt"])
        element.set_input_files.assert_called_once_with(["/path/to/file.txt"])


# ─── Reading ──────────────────────────────────────────────


class TestReadText:
    def test_reads_text_content(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        first.text_content.return_value = "  Hello World  "
        mock_page.locator.return_value = locator

        result = driver.read_text([{"strategy": "css", "selector": ".text"}])
        assert result == "Hello World"

    def test_returns_empty_for_none(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        first.text_content.return_value = None
        mock_page.locator.return_value = locator

        result = driver.read_text([{"strategy": "css", "selector": ".text"}])
        assert result == ""


class TestReadPattern:
    def test_matches_pattern(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        first.text_content.return_value = "3 items left"
        mock_page.locator.return_value = locator

        result = driver.read_pattern(
            [{"strategy": "css", "selector": ".count"}], r"(\d+) items? left"
        )
        assert result == "3"

    def test_returns_none_on_no_match(
        self, driver: PlaywrightDriver, mock_page: MagicMock
    ) -> None:
        locator = MagicMock()
        first = MagicMock()
        locator.first = first
        first.text_content.return_value = "no numbers here"
        mock_page.locator.return_value = locator

        result = driver.read_pattern(
            [{"strategy": "css", "selector": ".count"}], r"(\d+) items? left"
        )
        assert result is None


# ─── Keyboard ──────────────────────────────────────────────


class TestPressKey:
    def test_presses_single_key(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.press_key("Enter")
        mock_page.keyboard.press.assert_called_once_with("Enter")

    def test_presses_with_modifiers(
        self, driver: PlaywrightDriver, mock_page: MagicMock
    ) -> None:
        driver.press_key("a", modifiers=["Control", "Shift"])
        mock_page.keyboard.press.assert_called_once_with("Control+Shift+a")


class TestPressSequentially:
    def test_presses_sequentially(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.press_sequentially(element, "hello", delay=50)
        element.press_sequentially.assert_called_once_with("hello", delay=50)


# ─── Scrolling ─────────────────────────────────────────────


class TestScroll:
    def test_scroll_top(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.scroll("top")
        mock_page.evaluate.assert_called()

    def test_scroll_bottom(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.scroll("bottom")
        mock_page.evaluate.assert_called()

    def test_scroll_element(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.scroll(element)
        element.scroll_into_view_if_needed.assert_called_once()


# ─── Overlays ──────────────────────────────────────────────


class TestDismissOverlay:
    def test_press_escape(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        result = driver.dismiss_overlay({"type": "press_escape"})
        mock_page.keyboard.press.assert_called_once_with("Escape")
        assert result is True

    def test_returns_false_on_failure(
        self, driver: PlaywrightDriver, mock_page: MagicMock
    ) -> None:
        mock_page.keyboard.press.side_effect = Exception("fail")
        result = driver.dismiss_overlay({"type": "press_escape"})
        assert result is False


# ─── Events ────────────────────────────────────────────────


class TestDispatchEvent:
    def test_dispatches_event(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.dispatch_event(element, "change")
        element.dispatch_event.assert_called_once_with("change", None)

    def test_dispatches_with_detail(self, driver: PlaywrightDriver) -> None:
        element = MagicMock()
        driver.dispatch_event(element, "custom", detail={"key": "val"})
        element.dispatch_event.assert_called_once_with("custom", {"detail": {"key": "val"}})


# ─── Dialogs ───────────────────────────────────────────────


class TestHandleDialog:
    def test_accepts_dialog(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        dialog = MagicMock()
        dialog.message = "Are you sure?"
        mock_page.once = MagicMock()

        # Simulate dialog handler
        def capture_handler(event_name: str, handler: object) -> None:
            # Call the handler with the dialog mock
            handler(dialog)  # type: ignore[operator]

        mock_page.once.side_effect = capture_handler
        result = driver.handle_dialog("accept")
        assert result == "Are you sure?"


# ─── Waiting ───────────────────────────────────────────────


class TestWaitFor:
    def test_wait_selector(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        locator = MagicMock()
        mock_page.locator.return_value = locator
        driver.wait_for({"type": "selector", "value": ".loaded"})
        locator.wait_for.assert_called_once()

    def test_wait_timeout(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.wait_for({"type": "timeout", "value": 1000})
        mock_page.wait_for_timeout.assert_called_once_with(1000)

    def test_wait_url(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.wait_for({"type": "url", "value": "/dashboard"})
        mock_page.wait_for_url.assert_called_once()

    def test_wait_network_idle(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        driver.wait_for({"type": "network_idle"})
        mock_page.wait_for_load_state.assert_called_once()

    def test_unknown_wait_type_raises(self, driver: PlaywrightDriver) -> None:
        with pytest.raises(ValueError, match="Unknown wait condition"):
            driver.wait_for({"type": "magic"})


# ─── Diagnostics ───────────────────────────────────────────


class TestScreenshot:
    def test_returns_bytes(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        mock_page.screenshot.return_value = b"\x89PNG"
        result = driver.screenshot()
        assert result == b"\x89PNG"
        mock_page.screenshot.assert_called_once_with(full_page=True)


class TestEvaluate:
    def test_evaluates_js(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        mock_page.evaluate.return_value = "Test Page"
        result = driver.evaluate("document.title")
        assert result == "Test Page"


# ─── Context ───────────────────────────────────────────────


class TestGetPageContext:
    def test_returns_context(self, driver: PlaywrightDriver, mock_page: MagicMock) -> None:
        mock_page.url = "https://example.com"
        mock_page.title.return_value = "Test"
        mock_page.evaluate.return_value = "complete"
        ctx = driver.get_page_context()
        assert ctx["url"] == "https://example.com"
        assert ctx["title"] == "Test"
        assert ctx["readyState"] == "complete"


# ─── Multi-tab ─────────────────────────────────────────────


class TestMultiTab:
    def test_create_page(self, driver: PlaywrightDriver, mock_context: MagicMock) -> None:
        new_page = MagicMock()
        mock_context.new_page.return_value = new_page
        result = driver.create_page("tab2")
        assert result is new_page
        mock_context.new_page.assert_called_once()

    def test_get_named_page(self, driver: PlaywrightDriver, mock_context: MagicMock) -> None:
        new_page = MagicMock()
        mock_context.new_page.return_value = new_page
        driver.create_page("tab2")
        result = driver.get_named_page("tab2")
        assert result is new_page
        new_page.bring_to_front.assert_called_once()

    def test_get_unknown_page_raises(self, driver: PlaywrightDriver) -> None:
        with pytest.raises(RuntimeError, match="Page not found"):
            driver.get_named_page("nonexistent")
