import test from "node:test";
import assert from "node:assert/strict";
import { collectHls, MAX_HLS_BYTES, parseAttributeList, parseHlsPlaylist } from "../hls.js";

const base = "https://media.test/path/master.m3u8";
const encode = value => new TextEncoder().encode(value);
const decode = value => new TextDecoder().decode(value);
const media = (...lines) => ["#EXTM3U", "#EXT-X-TARGETDURATION:2", ...lines, "#EXT-X-ENDLIST"].join("\n");
const master = (...lines) => ["#EXTM3U", ...lines].join("\n");
const segment = (url, duration = 2) => [`#EXTINF:${duration},`, url];
function fixtures(entries) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      assert.ok(Object.hasOwn(entries, url), `Unexpected URL: ${url}`);
      const entry = entries[url];
      return typeof entry === "function" ? entry(options) : new Response(entry);
    },
  };
}

test("quoted attributes retain commas in codecs, rendition names and URLs", () => {
  const attributes = parseAttributeList('BANDWIDTH=123,CODECS="avc1.4d401f,mp4a.40.2",NAME="English, original",URI="video.m3u8?a=1,b=2"');
  assert.equal(attributes.CODECS, "avc1.4d401f,mp4a.40.2");
  assert.equal(attributes.NAME, "English, original");
  assert.equal(attributes.URI, "video.m3u8?a=1,b=2");
  for (const input of ['URI="unfinished', "BANDWIDTH=12,", "BANDWIDTH=12,BANDWIDTH=23", 'URI="a"junk']) assert.throws(() => parseAttributeList(input));
});

test("collects a relative media playlist with initialization and all segments in order", async () => {
  const mock = fixtures({
    [base]: media('#EXT-X-MAP:URI="init.mp4"', ...segment("one.m4s"), ...segment("../two.m4s")),
    "https://media.test/path/init.mp4": "INIT",
    "https://media.test/path/one.m4s": "FIRST",
    "https://media.test/two.m4s": "SECOND",
  });
  const progress = [];
  const result = await collectHls(base, { ...mock, onProgress: event => progress.push(event) });
  assert.equal(decode(result.video.bytes), "INITFIRSTSECOND");
  assert.equal(result.video.extension, "mp4");
  assert.equal(result.video.segmentCount, 2);
  assert.equal(result.video.duration, 4);
  assert.equal(result.totalBytes, 15);
  assert.equal(progress.at(-1).completedSegments, 2);
  assert.equal(progress.at(-1).totalSegments, 2);
  assert.ok(mock.requests.every(request => request.credentials === "include"));
});

test("selects highest supported bandwidth and its DEFAULT audio rendition", async () => {
  const mock = fixtures({
    [base]: master(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="Autoselect",AUTOSELECT=YES,URI="wrong-audio.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="Default, English",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=100,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="sound"', "low.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=900,CODECS="unknown.codec"', "unsupported.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=300,CODECS="avc1.640028,mp4a.40.2",AUDIO="sound",RESOLUTION=1920x1080', "high.m3u8"),
    "https://media.test/path/high.m3u8": media(...segment("video.ts")),
    "https://media.test/path/audio.m3u8": media(...segment("sound.aac")),
    "https://media.test/path/video.ts": "VIDEO",
    "https://media.test/path/sound.aac": "AUDIO",
  });
  const result = await collectHls(base, mock);
  assert.equal(result.variant.bandwidth, 300);
  assert.equal(result.variant.resolution, "1920x1080");
  assert.equal(decode(result.video.bytes), "VIDEO");
  assert.equal(decode(result.audio.bytes), "AUDIO");
  assert.equal(result.video.extension, "ts");
  assert.equal(result.totalBytes, 10);
});

test("does not select an audio-only variant for the main video track", async () => {
  const mock = fixtures({
    [base]: master('#EXT-X-STREAM-INF:BANDWIDTH=900,CODECS="mp4a.40.2"', "audio-only.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=300,CODECS="avc1.640028,mp4a.40.2"', "video.m3u8"),
    "https://media.test/path/video.m3u8": media(...segment("v.ts")),
    "https://media.test/path/v.ts": "AV",
  });
  const result = await collectHls(base, mock);
  assert.equal(result.variant.bandwidth, 300);
  assert.equal(decode(result.video.bytes), "AV");
});

test("audio-only codecs remain supported inside an external audio master", async () => {
  const mock = fixtures({
    [base]: master('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="audio",URI="audio-master.m3u8"', '#EXT-X-STREAM-INF:BANDWIDTH=300,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"', "video.m3u8"),
    "https://media.test/path/video.m3u8": media(...segment("v.ts")),
    "https://media.test/path/audio-master.m3u8": master('#EXT-X-STREAM-INF:BANDWIDTH=100,CODECS="mp4a.40.2"', "audio.m3u8"),
    "https://media.test/path/audio.m3u8": media(...segment("a.aac")),
    "https://media.test/path/v.ts": "V",
    "https://media.test/path/a.aac": "A",
  });
  const result = await collectHls(base, mock);
  assert.equal(decode(result.video.bytes), "V");
  assert.equal(decode(result.audio.bytes), "A");
});

test("audio preference falls back to AUTOSELECT, then first rendition", async () => {
  for (const autoselect of [true, false]) {
    const mock = fixtures({
      [base]: master('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="first",URI="first.m3u8"', `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="second",AUTOSELECT=${autoselect ? "YES" : "NO"},URI="second.m3u8"`, '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"', "v.m3u8"),
      "https://media.test/path/v.m3u8": media(...segment("v.ts")),
      [`https://media.test/path/${autoselect ? "second" : "first"}.m3u8`]: media(...segment("a.ts")),
      "https://media.test/path/v.ts": "V",
      "https://media.test/path/a.ts": "A",
    });
    assert.equal(decode((await collectHls(base, mock)).audio.bytes), "A");
  }
});

test("audio rendition without URI uses the muxed audio in video segments", async () => {
  const mock = fixtures({
    [base]: master('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="muxed",DEFAULT=YES', '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"', "v.m3u8"),
    "https://media.test/path/v.m3u8": media(...segment("v.ts")),
    "https://media.test/path/v.ts": "AV",
  });
  const result = await collectHls(base, mock);
  assert.equal(result.audio, undefined);
  assert.equal(decode(result.video.bytes), "AV");
});

test("resolves relative resources against redirected playlist URL", async () => {
  const mock = fixtures({
    [base]: () => { const response = new Response(media(...segment("s.ts"))); Object.defineProperty(response, "url", { value: "https://cdn.test/new/playlist.m3u8" }); return response; },
    "https://cdn.test/new/s.ts": "REDIRECTED",
  });
  assert.equal(decode((await collectHls(base, mock)).video.bytes), "REDIRECTED");
});

test("explicit and consecutive implicit byte ranges verify 206 and include ranged init", async () => {
  const data = encode("HEADERaabbcc");
  const mock = fixtures({
    [base]: media('#EXT-X-MAP:URI="whole.mp4",BYTERANGE="6@0"', "#EXT-X-BYTERANGE:2@6", ...segment("whole.mp4"), "#EXT-X-BYTERANGE:2", ...segment("whole.mp4"), "#EXT-X-BYTERANGE:2", ...segment("whole.mp4")),
    "https://media.test/path/whole.mp4": ({ headers }) => {
      const [, start, end] = headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
      return new Response(data.slice(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${data.length}` } });
    },
  });
  const result = await collectHls(base, mock);
  assert.equal(decode(result.video.bytes), "HEADERaabbcc");
  assert.deepEqual(mock.requests.slice(1).map(request => request.headers.Range), ["bytes=0-5", "bytes=6-7", "bytes=8-9", "bytes=10-11"]);
});

test("Range-ignoring 200 servers are sliced without duplicating the resource", async () => {
  const mock = fixtures({
    [base]: media("#EXT-X-BYTERANGE:2@2", ...segment("all.ts"), "#EXT-X-BYTERANGE:3", ...segment("all.ts")),
    "https://media.test/path/all.ts": "__AABBB___",
  });
  assert.equal(decode((await collectHls(base, mock)).video.bytes), "AABBB");
});

test("implicit byte ranges require the immediately preceding segment on the same resource", () => {
  for (const body of [
    media("#EXT-X-BYTERANGE:2", ...segment("a.ts")),
    media("#EXT-X-BYTERANGE:2@0", ...segment("a.ts"), "#EXT-X-BYTERANGE:2", ...segment("b.ts")),
    media("#EXT-X-BYTERANGE:2@0", ...segment("a.ts"), ...segment("b.ts"), "#EXT-X-BYTERANGE:2", ...segment("a.ts")),
  ]) assert.throws(() => parseHlsPlaylist(body, base), /implicit HLS byte range/);
});

test("incorrect Content-Range, truncated range, unsolicited partial and short 200 all fail", async () => {
  const scenarios = [
    { range: true, response: () => new Response("AB", { status: 206, headers: { "content-range": "bytes 0-1/10" } }), error: /Content-Range/ },
    { range: true, response: () => new Response("A", { status: 206, headers: { "content-range": "bytes 2-3/10" } }), error: /truncated|wrong length/ },
    { range: false, response: () => new Response("AB", { status: 206, headers: { "content-range": "bytes 0-1/10" } }), error: /Content-Range/ },
    { range: true, response: () => new Response("ABC"), error: /too few bytes/ },
    { range: true, response: () => new Response("AB", { status: 206, headers: { "content-range": "bytes 2-3/3" } }), error: /Content-Range/ },
  ];
  for (const scenario of scenarios) {
    const mock = fixtures({ [base]: media(...(scenario.range ? ["#EXT-X-BYTERANGE:2@2"] : []), ...segment("s.ts")), "https://media.test/path/s.ts": scenario.response });
    await assert.rejects(collectHls(base, mock), scenario.error);
  }
});

test("rejects live, encrypted, missing, discontinuous and switched-init playlists", () => {
  const cases = [
    [master(...segment("s.ts")), /live or unfinished/],
    [media('#EXT-X-KEY:METHOD=AES-128,URI="secret.key"', ...segment("s.ts")), /Encrypted or DRM/],
    [media('#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd:key"', ...segment("s.ts")), /Encrypted or DRM/],
    [media("#EXT-X-GAP", ...segment("s.ts")), /missing segments/],
    [media(...segment("s.ts"), "#EXT-X-DISCONTINUITY", ...segment("s2.ts")), /discontinuities/],
    [media('#EXT-X-MAP:URI="one.mp4"', ...segment("s.m4s"), '#EXT-X-MAP:URI="two.mp4"', ...segment("s2.m4s")), /initialization section/],
    [media("#EXT-X-SKIP:SKIPPED-SEGMENTS=2", ...segment("s.ts")), /Partial HLS/],
  ];
  for (const [body, error] of cases) assert.throws(() => parseHlsPlaylist(body, base), error);
  assert.equal(parseHlsPlaylist(media("#EXT-X-KEY:METHOD=NONE", ...segment("s.ts")), base).type, "media");
});

test("DRM in a master playlist is rejected before any child resources are fetched", async () => {
  const mock = fixtures({ [base]: master('#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"', "#EXT-X-STREAM-INF:BANDWIDTH=123", "video.m3u8") });
  await assert.rejects(collectHls(base, mock), /Encrypted or DRM/);
  assert.equal(mock.requests.length, 1);
});

test("unsupported URL schemes, embedded credentials and malformed segment entries fail", () => {
  for (const url of ["file:///secret", "data:video/mp4,abc", "blob:https://media.test/test", "javascript:alert(1)", "https://user:password@media.test/v.ts"])
    assert.throws(() => parseHlsPlaylist(media(...segment(url)), base), /HTTP or HTTPS/);
  assert.throws(() => parseHlsPlaylist(media("missing-extinf.ts"), base), /EXTINF/);
  assert.throws(() => parseHlsPlaylist(media("#EXTINF:2,"), base), /ends before/);
  assert.throws(() => parseHlsPlaylist("<html>not a playlist</html>", base), /valid HLS/);
});

test("playlist cycles and excessive nesting fail without fetching indefinitely", async () => {
  const cycle = fixtures({ [base]: master("#EXT-X-STREAM-INF:BANDWIDTH=1", "master.m3u8") });
  await assert.rejects(collectHls(base, cycle), /cycle/);
  assert.equal(cycle.requests.length, 1);
  let count = 0;
  await assert.rejects(collectHls(base, { fetchImpl: async () => new Response(master("#EXT-X-STREAM-INF:BANDWIDTH=1", `level${++count}.m3u8`)) }), /depth of four/);
  assert.equal(count, 4);
});

test("all playlists are validated before downloading video or external audio segments", async () => {
  const mock = fixtures({
    [base]: master('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="audio",URI="audio.m3u8"', '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"', "v.m3u8"),
    "https://media.test/path/v.m3u8": media(...segment("v.ts")),
    "https://media.test/path/audio.m3u8": master(...segment("a.ts")),
  });
  await assert.rejects(collectHls(base, mock), /live or unfinished/);
  assert.equal(mock.requests.length, 3);
});

test("announced oversized responses are cancelled before reading", async () => {
  let cancelled = false;
  const mock = fixtures({
    [base]: media(...segment("huge.ts")),
    "https://media.test/path/huge.ts": () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": String(MAX_HLS_BYTES + 1) } }),
  });
  await assert.rejects(collectHls(base, mock), /512 MiB/);
  assert.equal(cancelled, true);
});

test("streaming size limit cancels bodies even when content length is missing", async () => {
  let cancelled = false;
  const sharedChunk = new Uint8Array(32 * 1024 * 1024);
  const mock = fixtures({
    [base]: media(...segment("huge.ts")),
    "https://media.test/path/huge.ts": () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(sharedChunk); }, cancel() { cancelled = true; } })),
  });
  await assert.rejects(collectHls(base, mock), /512 MiB/);
  assert.equal(cancelled, true);
});

test("playlist responses have a smaller streaming size limit", async () => {
  let cancelled = false;
  const sharedChunk = new Uint8Array(1024 * 1024);
  await assert.rejects(collectHls(base, { fetchImpl: async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(sharedChunk); }, cancel() { cancelled = true; } })) }), /playlist is too large/);
  assert.equal(cancelled, true);
});

test("an aborted job makes no requests and a failed segment stops collection", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collectHls(base, { signal: controller.signal, fetchImpl: () => assert.fail("must not fetch") }), { name: "AbortError" });
  const mock = fixtures({ [base]: media(...segment("first.ts"), ...segment("second.ts")), "https://media.test/path/first.ts": () => new Response("gone", { status: 404 }) });
  await assert.rejects(collectHls(base, mock), /HTTP 404/);
  assert.equal(mock.requests.length, 2);
});

test("fetch implementations are invoked without a custom receiver", async () => {
  const result = await collectHls(base, { fetchImpl: async function (url) {
    assert.equal(this, undefined);
    return new Response(url === base ? media(...segment("s.ts")) : "S");
  } });
  assert.equal(decode(result.video.bytes), "S");
});

test("request timeout aborts a server that never returns headers", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  const pending = collectHls(base, { fetchImpl: (url, { signal }) => { requestSignal = signal; return new Promise(() => {}); } });
  const rejected = assert.rejects(pending, /timed out after 30 seconds/);
  context.mock.timers.tick(30000);
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test("request timeout includes a stalled response body and cancels its reader", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  let cancelled = false;
  const pending = collectHls(base, { fetchImpl: async () => new Response(new ReadableStream({
    pull() { started(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 })) });
  const rejected = assert.rejects(pending, /timed out after 30 seconds/);
  await reading;
  context.mock.timers.tick(30000);
  await rejected;
  assert.equal(cancelled, true);
});

test("caller cancellation propagates to an in-flight request", async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = collectHls(base, { signal: controller.signal, fetchImpl: (url, { signal }) => { requestSignal = signal; return new Promise(() => {}); } });
  const rejected = assert.rejects(pending, /Stopped by user/);
  controller.abort(new Error("Stopped by user"));
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test("successful requests clear their timeout timers", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  await collectHls(base, { fetchImpl: async (url, { signal }) => {
    signals.push(signal);
    return new Response(url === base ? media(...segment("s.ts")) : "S");
  } });
  context.mock.timers.tick(30001);
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => !signal.aborted));
});
