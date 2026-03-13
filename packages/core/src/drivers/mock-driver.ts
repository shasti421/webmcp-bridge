/**
 * MockDriver — test double for BridgeDriver.
 * Used by all unit tests in core. Every method is a vitest spy (vi.fn()).
 *
 * Usage:
 *   const driver = createMockDriver();
 *   (driver.readText as ReturnType<typeof vi.fn>).mockResolvedValue('Hello');
 *   const text = await driver.readText([...]);
 */
import { vi } from 'vitest';

import type { BridgeDriver, ElementHandle, PageHandle, PageContext } from '../types/bridge-driver.js';

const DEFAULT_ELEMENT_HANDLE: ElementHandle = { _brand: 'ElementHandle' };

const DEFAULT_PAGE_CONTEXT: PageContext = {
  url: 'about:blank',
  title: '',
  readyState: 'complete',
};

export function createMockDriver(overrides?: Partial<BridgeDriver>): BridgeDriver {
  const defaults: BridgeDriver = {
    // Navigation
    goto: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),

    // Element discovery
    findElement: vi.fn().mockResolvedValue(DEFAULT_ELEMENT_HANDLE),

    // Interactions
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    dragDrop: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),

    // Reading
    readText: vi.fn().mockResolvedValue(''),
    readPattern: vi.fn().mockResolvedValue(null),

    // Keyboard
    pressKey: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),

    // Scrolling
    scroll: vi.fn().mockResolvedValue(undefined),

    // Overlays
    dismissOverlay: vi.fn().mockResolvedValue(false),

    // Events
    dispatchEvent: vi.fn().mockResolvedValue(undefined),

    // Frames
    switchFrame: vi.fn().mockResolvedValue(undefined),

    // Dialogs
    handleDialog: vi.fn().mockResolvedValue(''),

    // Waiting
    waitFor: vi.fn().mockResolvedValue(undefined),

    // Diagnostics
    screenshot: vi.fn().mockResolvedValue(Buffer.alloc(0)),

    // JS escape hatch
    evaluate: vi.fn().mockResolvedValue(undefined),

    // Context
    getPageContext: vi.fn().mockResolvedValue({ ...DEFAULT_PAGE_CONTEXT }),

    // Multi-tab
    getNamedPage: vi.fn().mockImplementation((name: string): Promise<PageHandle> =>
      Promise.resolve({ _brand: 'PageHandle', name }),
    ),
    createPage: vi.fn().mockImplementation((name: string): Promise<PageHandle> =>
      Promise.resolve({ _brand: 'PageHandle', name }),
    ),
  };

  return { ...defaults, ...overrides };
}
