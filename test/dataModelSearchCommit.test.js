const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const functionSource = source.slice(source.indexOf("async function typeJetInput("), source.indexOf("const schedulerSleep ="));

async function commitEvents(key) {
  const events = [];
  const context = {
    chrome: {
      scripting: { executeScript: async () => [] },
      debugger: {
        attach: async () => {},
        sendCommand: async (_target, _method, event) => { events.push(event); },
        detach: async () => {}
      }
    }
  };
  vm.runInNewContext(`${functionSource}\nthis.typeJetInput = typeJetInput;`, context);
  await context.typeJetInput(1, "search-input-text|input", "A", "Data Model search", key);
  return events.filter((event) => !key || event.key === key).map((event) => event.type);
}

test("generic JET Enter emits one keydown", async () => {
  assert.deepEqual(await commitEvents("Enter"), ["keyDown", "keyUp"]);
});

test("Data Model search enters text once and submits with Enter, without an icon click", async () => {
  const commands = [];
  const context = {
    chrome: {
      scripting: { executeScript: async () => [] },
      debugger: {
        attach: async () => {},
        sendCommand: async (_target, method, args) => { commands.push([method, args]); },
        detach: async () => {}
      }
    }
  };
  vm.runInNewContext(`${functionSource}\nthis.submitDataModelObjectSearch = submitDataModelObjectSearch;`, context);
  await context.submitDataModelObjectSearch(1, "search-input-text|input", "Profile_Test");
  assert.deepEqual(commands.map(([method]) => method), ["Input.insertText", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]);
  assert.equal(commands[0][1].text, "Profile_Test");
  assert.deepEqual(commands.slice(1).map(([, args]) => args.type), ["rawKeyDown", "keyUp"]);
});

test("JET form Tab retains its existing focus-transition sequence", async () => {
  assert.deepEqual(await commitEvents("Tab"), ["rawKeyDown", "keyDown", "keyUp"]);
});

test("relationship combobox search types without closing its results", async () => {
  assert.deepEqual(await commitEvents(null), ["rawKeyDown", "char", "keyUp"]);
});
