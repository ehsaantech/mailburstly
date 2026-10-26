// Health probe — no service or repository; it is a liveness check.
// The actual probe is wired in index.ts via createApp({ health }).
export {};