import test from "node:test";
import assert from "node:assert/strict";
import { FFmpeg } from "../vendor/ffmpeg/index.js";
import { CORE_URL, WASM_URL, CLASS_WORKER_URL, validateLoadConfig } from "../vendor/ffmpeg/const.js";

test("FFmpeg accepts only the exact packaged asset URLs", () => {
  assert.deepEqual(validateLoadConfig(), { coreURL: CORE_URL, wasmURL: WASM_URL });
  assert.deepEqual(validateLoadConfig({ coreURL: CORE_URL, wasmURL: WASM_URL, classWorkerURL: CLASS_WORKER_URL }),
    { coreURL: CORE_URL, wasmURL: WASM_URL });
  for (const [key, local] of Object.entries({ coreURL: CORE_URL, wasmURL: WASM_URL, classWorkerURL: CLASS_WORKER_URL })) {
    for (const unsafe of ["https://cdn.example.test/code.js", "data:text/javascript,", "blob:https://example.test/id", local + "?redirect=1", local + "#fragment", local.replace(/[^/]+$/, "other.js"), "", null]) {
      assert.throws(() => validateLoadConfig({ [key]: unsafe }), /Only the bundled/);
    }
  }
  assert.throws(() => validateLoadConfig({ workerURL: "https://example.test/worker.js" }), /unsupported/);
});

test("FFmpeg rejects external overrides before it can construct a Worker", () => {
  let constructed = 0;
  const previous = globalThis.Worker;
  globalThis.Worker = class { constructor() { constructed++; } };
  try {
    for (const key of ["coreURL", "wasmURL", "classWorkerURL", "workerURL"]) {
      assert.throws(() => new FFmpeg().load({ [key]: "https://example.test/executable.js" }));
    }
    assert.equal(constructed, 0);
  } finally { globalThis.Worker = previous; }
});

test("FFmpeg creates its packaged module worker and sends only local core URLs", async () => {
  const previous = globalThis.Worker;
  const constructed = [];
  const requests = [];
  globalThis.Worker = class {
    constructor(url, options) { constructed.push({ url: url.href, options }); }
    postMessage(request) {
      requests.push(request);
      queueMicrotask(() => this.onmessage({ data: { id: request.id, type: request.type, data: true } }));
    }
    terminate() {}
  };
  const ffmpeg = new FFmpeg();
  try {
    assert.equal(await ffmpeg.load(), true);
    assert.deepEqual(constructed, [{ url: CLASS_WORKER_URL, options: { type: "module" } }]);
    assert.deepEqual(requests[0].data, { coreURL: CORE_URL, wasmURL: WASM_URL });
    assert.equal(ffmpeg.loaded, true);
  } finally { ffmpeg.terminate(); globalThis.Worker = previous; }
});

test("the worker independently rejects external WASM and code before any fetch", async () => {
  const previousSelf = globalThis.self;
  const previousFetch = globalThis.fetch;
  const replies = [];
  let fetches = 0;
  globalThis.self = { postMessage: message => replies.push(message) };
  globalThis.fetch = () => { fetches++; throw new Error("No network expected"); };
  try {
    await import("../vendor/ffmpeg/worker.js");
    for (const key of ["coreURL", "wasmURL", "classWorkerURL", "workerURL"]) {
      await self.onmessage({ data: { id: key, type: "LOAD", data: { [key]: "https://example.test/executable" } } });
    }
    assert.equal(replies.length, 4);
    assert.ok(replies.every(reply => reply.type === "ERROR" && /bundled/.test(reply.data)));
    assert.equal(fetches, 0);
  } finally { globalThis.self = previousSelf; globalThis.fetch = previousFetch; }
});
