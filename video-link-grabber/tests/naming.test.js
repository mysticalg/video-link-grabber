import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pageAction } from "../contentScript.js";

// A small document fixture exercises the serialized entrypoint with no imported helpers.
function element(tag, attributes = {}, children = [], text = "") {
  const node = { tag, attributes, children, parent: null, textContent: text, style: {},
    getAttribute(name) { return this.attributes[name] ?? null; },
    matches(selector) {
      return selector.split(",").some(part => {
        if (part === "*") return true;
        const selectedTag = part.match(/^\w+/)?.[0];
        const conditions = [...part.matchAll(/\[([\w-]+)(?:(\*?=)"([^"]*)")?\]/g)];
        return (!selectedTag || selectedTag === this.tag) && conditions.every(([, attr, operator, value]) =>
          attr in this.attributes && (!operator || (operator === "*=" ? this.attributes[attr].includes(value) : this.attributes[attr] === value)));
      });
    },
    closest(selector) { for (let current = this; current; current = current.parent) if (current.matches(selector)) return current; return null; },
    contains(other) { for (let current = other; current; current = current.parent) if (current === this) return true; return false; },
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  for (const [key, value] of Object.entries(attributes)) node[key] = value;
  for (const child of children) child.parent = node;
  return node;
}

function video(id, extra = {}) {
  return element("video", { src: `blob:https://x.com/${id}`, currentSrc: `blob:https://x.com/${id}`, ...extra });
}

function post(author, id, caption, children = []) {
  return element("article", { "data-testid": "tweet" }, [
    element("a", { href: `https://x.com/${author}/status/${id}` }, [element("time")]),
    element("div", { "data-testid": "tweetText" }, [], caption), ...children,
  ]);
}

async function scan(children, { title = "Home / X", metadata = [], sources = [], resources = [] } = {}) {
  const doc = element("document", {}, [...metadata, ...children]);
  Object.assign(doc, { baseURI: "https://x.com/home", title, documentElement: { outerHTML: "" },
    getElementById(id) { return this.querySelectorAll("*").find(node => node.attributes.id === id); },
  });
  const window = { [Symbol.for("video-link-grabber.sources.v1")]: { sources } };
  const context = vm.createContext({ window, document: doc, location: { hostname: "x.com" }, URL,
    performance: { getEntriesByType: () => resources.map(name => ({ name })) } });
  const result = await vm.runInContext(`(${pageAction.toString()})("SCAN")`, context);
  assert.equal(result.ok, true, result.error);
  return result.items;
}

test("X filenames use only their own post text without added usernames or numeric suffixes", async () => {
  const quote = post("quoted", "2222222222222222222", "Quoted volcanic eruption", [video("quote")]);
  const items = await scan([post("astronomy", "1234567890123456789", "星空 from the rooftop https://t.co/abc", [video("one"), quote, video("two")])]);
  const names = Object.fromEntries(items.map(item => [item.url.split("/").pop(), item.filename]));
  assert.equal(names.one, "星空 from the rooftop");
  assert.equal(names.two, "星空 from the rooftop");
  assert.equal(names.quote, "Quoted volcanic eruption");
});

test("unmarked clickable quote cards keep their captions separate without author prefixes", async () => {
  const quote = element("div", { role: "link" }, [
    element("a", { href: "https://x.com/quote_author/status/2222" }, [element("time")]),
    element("div", { "data-testid": "tweetText" }, [], "Quoted caption"), video("quote"),
  ]);
  const items = await scan([post("parent_author", "1111", "Original caption", [video("parent"), quote])]);
  assert.equal(items[0].filename, "Original caption");
  assert.equal(items[1].filename, "Quoted caption");
});

test("associated source links retain the selected post name rather than CDN filenames", async () => {
  const streamUrl = "https://video.twimg.com/ext_tw_video/123/pu/pl/master.m3u8";
  const directUrl = "https://video.twimg.com/ext_tw_video/123/pu/vid/clip.mp4";
  const poster = "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/abc.jpg";
  const items = await scan([post("maker", "5555", "A useful title", [video("abc", { poster })])], {
    sources: [{ url: streamUrl, poster, verified: true }, { url: directUrl, poster, verified: true, type: "video/mp4", bitrate: 1000 }],
    resources: [streamUrl, directUrl],
  });
  assert.equal(items.find(item => item.url === streamUrl).filename, "A useful title.m3u8");
  assert.equal(items.find(item => item.url === directUrl).filename, "A useful title.mp4");
});

test("media accessibility text and figure captions outrank page metadata", async () => {
  const figure = element("figure", {}, [video("caption"), element("figcaption", {}, [], "海辺の夕焼け")]);
  const items = await scan([video("named", { "aria-label": "Meteor shower 🌠" }), figure], { title: "Page title" });
  assert.equal(items[0].filename, "Meteor shower 🌠");
  assert.equal(items[1].filename, "海辺の夕焼け");
});

test("page metadata fallback is readable and long Unicode captions truncate safely", async () => {
  const metadata = [element("meta", { property: "og:title", content: "Science highlights" })];
  assert.equal((await scan([video("uuid")], { metadata }))[0].filename, "Science highlights");
  const items = await scan([post("astronomy", "1234567890123456789", "星空🌠".repeat(80), [video("one"), video("two")])]);
  assert.equal(items[0].filename, items[1].filename);
  assert.doesNotMatch(items[0].filename, /1234567890123456789/);
  for (const item of items) {
    assert.ok(item.filename.length <= 150);
    assert.equal(item.filename.isWellFormed(), true);
  }
});
