export const MIME_TYPE_JAVASCRIPT = "text/javascript";
export const MIME_TYPE_WASM = "application/wasm";
// Video Link Grabber patch: executable assets always come from this package.
export const CORE_VERSION = "0.12.10";
export const CORE_URL = new URL("../core/ffmpeg-core.js", import.meta.url).href;
export const WASM_URL = new URL("../core/ffmpeg-core.wasm", import.meta.url).href;
export const CLASS_WORKER_URL = new URL("./worker.js", import.meta.url).href;
export function validateLoadConfig(config = {}) {
    for (const [key, expected] of Object.entries({
        coreURL: CORE_URL, wasmURL: WASM_URL, classWorkerURL: CLASS_WORKER_URL,
    })) {
        if (config[key] !== undefined && config[key] !== expected) {
            throw new Error(`Only the bundled FFmpeg ${key} is supported.`);
        }
    }
    if (config.workerURL !== undefined) {
        throw new Error("External FFmpeg workers are unsupported by the bundled single-thread core.");
    }
    return { coreURL: CORE_URL, wasmURL: WASM_URL };
}
export var FFMessageType;
(function (FFMessageType) {
    FFMessageType["LOAD"] = "LOAD";
    FFMessageType["EXEC"] = "EXEC";
    FFMessageType["FFPROBE"] = "FFPROBE";
    FFMessageType["WRITE_FILE"] = "WRITE_FILE";
    FFMessageType["READ_FILE"] = "READ_FILE";
    FFMessageType["DELETE_FILE"] = "DELETE_FILE";
    FFMessageType["RENAME"] = "RENAME";
    FFMessageType["CREATE_DIR"] = "CREATE_DIR";
    FFMessageType["LIST_DIR"] = "LIST_DIR";
    FFMessageType["DELETE_DIR"] = "DELETE_DIR";
    FFMessageType["ERROR"] = "ERROR";
    FFMessageType["DOWNLOAD"] = "DOWNLOAD";
    FFMessageType["PROGRESS"] = "PROGRESS";
    FFMessageType["LOG"] = "LOG";
    FFMessageType["MOUNT"] = "MOUNT";
    FFMessageType["UNMOUNT"] = "UNMOUNT";
})(FFMessageType || (FFMessageType = {}));
