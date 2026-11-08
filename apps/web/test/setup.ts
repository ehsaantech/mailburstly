/**
 * Test setup for the web app.
 *
 * The web app has no test runner of its own, so `bun test` runs it with
 * happy-dom registered as the DOM. That gives the component tests a real
 * document to render into, without pulling a bundler into the loop.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Registering twice throws, and the file may be loaded by both the
// bunfig preload and an explicit --preload.
if (!(globalThis as { document?: unknown }).document) {
  GlobalRegistrator.register({ url: "http://localhost/" });
}

// React 19 wants to know it is running inside a test act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
