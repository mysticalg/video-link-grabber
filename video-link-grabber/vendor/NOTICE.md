# Bundled FFmpeg components

The stream downloader uses the following locally bundled upstream packages. No
FFmpeg executable code is fetched from a CDN at runtime.

| Component | Bundled files | Version | Upstream license |
| --- | --- | --- | --- |
| `@ffmpeg/ffmpeg` | `ffmpeg/*.js`, from the package's `dist/esm` directory | 0.12.15 | MIT |
| `@ffmpeg/core` | `core/ffmpeg-core.js` and `core/ffmpeg-core.wasm`, from `dist/esm` | 0.12.10 | GPL-2.0-or-later |

This software uses FFmpeg, copyright the FFmpeg developers, built under the GNU
General Public License version 2 or later. FFmpeg is provided without warranty;
see [the included GPLv2 text](LICENSE-ffmpeg-core-GPLv2.txt).
The wrapper's copyright notice and permission terms are preserved in
[the included MIT license](LICENSE-ffmpeg-wasm-MIT.txt).

## Exact upstream source and build references

Both package versions are declared by the upstream
[v12.15 release](https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15),
at commit `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`.
The tag is spelled `v12.15`, not `v0.12.15`. The older tag `v0.12.10` is not the
source reference for the bundled core 0.12.10 package.

- [ffmpeg.wasm source archive at the release commit](https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz)
- [Wrapper package metadata](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/packages/ffmpeg/package.json)
- [Core package metadata](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/packages/core/package.json)
- [Core Dockerfile and dependency source references](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile)
- [Core build scripts](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build)
- [Core Makefile](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Makefile)
- [FFmpeg n5.1.4 source archive](https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n5.1.4.tar.gz)
- [FFmpeg n5.1.4 licensing information](https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/LICENSE.md)

The Dockerfile pins FFmpeg to `n5.1.4` and the Emscripten SDK image to `3.1.40`.
It enables GPL components, including x264 and x265; the core must not be treated
as MIT merely because its JavaScript wrapper is MIT. The Dockerfile links the
other codec, container, font and rendering dependency repositories and their
selected versions. Those dependencies' source and notices are part of the
upstream build, in addition to FFmpeg and the WebAssembly binding code.

## Rebuilding and verifying the vendored assets

Check out the release commit above. The upstream `make prd` target builds the
single-thread production core using Docker Buildx and emits both UMD and ESM
assets under `packages/core/dist`. This extension uses the ESM pair. The wrapper
package's `build:esm` script builds its TypeScript sources into `dist/esm`.

These are upstream build instructions, not a claim that a source rebuild was
performed here. Some dependency references in the Dockerfile are moving branches
(for example x264 `4-cores` and LAME `master`), so the tag alone does not establish
a bit-for-bit reproducible rebuild. Preserve the resolved dependency commits and
toolchain image digest when preparing a reproducible source build.

The published npm artifacts used for these versions are:

- [@ffmpeg/core 0.12.10 tarball](https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz), npm integrity `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`
- [@ffmpeg/ffmpeg 0.12.15 tarball](https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz), npm integrity `sha512-1C8Obr4GsN3xw+/1Ww6PFM84wSQAGsdoTuTWPOj2OizsRDLT4CXTaVjPhkw6ARyDus1B9X/L2LiXHqYYsGnRFw==`

SHA-256 of the bundled core assets:

```text
67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3  core/ffmpeg-core.js
9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7  core/ffmpeg-core.wasm
```

## Local wrapper changes for the Chrome Web Store

The wrapper files below are modified from `@ffmpeg/ffmpeg` 0.12.15. The MIT
license and copyright notice remain included. The core JavaScript and WASM
assets above are unchanged.

- `ffmpeg/const.js`: replace the upstream CDN fallback with the packaged core
  URL, reflect the bundled core version 0.12.10, and validate that code, WASM,
  and class-worker URLs name only their exact packaged files.
- `ffmpeg/classes.js`: reject executable URL overrides before creating a worker;
  always construct the local module worker.
- `ffmpeg/worker.js`: statically import the packaged ESM core, independently
  validate the load configuration, and remove the classic-worker import path
  and all remote fallback loading. This package uses the single-thread core.

SHA-256 hashes distinguish the unmodified upstream wrapper files from the local
files distributed by this extension:

| File | Original upstream SHA-256 | Patched SHA-256 |
| --- | --- | --- |
| `ffmpeg/const.js` | `9e3bc9dd84781c81daf459e2c46eeec815edac35089832681d9a9a0f383060d0` | `18d3519acb202009a2b12e031f5f85a0f142d83c8aefc1cc7543f5dfed688fe5` |
| `ffmpeg/classes.js` | `7a829c898bdbc3a8806652a5502d9101178ce4e988a2c50b3abc1306ce4fc919` | `9178503ae968c72494037bc1ad06e21bba95203962d242893c8948c8447033a5` |
| `ffmpeg/worker.js` | `feff0ac937ea225e997e1fae997a74f8b8d572423a526da59eb56624b1f3cde7` | `53ed51eb9744ed05e89d735bf91a5d76a3c5186c93b418e051bcb4832a32fe54` |

The URL validation regression tests are in `tests/vendor.test.js` in the
development source tree. The store package excludes development tests and
includes only runtime assets and these vendor notices.

## Source distribution for this release

Video Link Grabber 1.2.0 distributes the bundled core's corresponding-source
materials alongside the extension:
[download the FFmpeg core 0.12.10 source bundle](https://github.com/mysticalg/video-link-grabber/releases/download/v1.2.0/ffmpeg-core-0.12.10-source.zip).
The bundle contains 21 upstream source archives, dependency licensing materials,
and build references. The provenance and source-rebuild limitations above still
apply; distributing this bundle does not claim a bit-for-bit rebuild was tested.

Source ZIP SHA-256:
`0dcdca10f2028e85b326fa85b0ec1e0d4376ca90e797b72c5867232fad9a1e92`.
