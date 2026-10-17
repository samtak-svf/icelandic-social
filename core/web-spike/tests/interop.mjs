// @ts-check
// The spike's proof (docs/web-client-feasibility.md): spjall-mls compiled to
// wasm32 joins a group a native spjall-mls made, and an envelope crosses
// both ways. Run by core/web-spike/run.sh, which builds both sides first.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const [pkg, native, expect] = process.argv.slice(2);
const spike = await import(pathToFileURL(resolve(pkg, "spjall_web_spike.js")).href);
const dir = mkdtempSync(join(tmpdir(), "spjall-web-spike-"));
const file = (name) => join(dir, name);
const run = (...args) =>
  execFileSync(native, [args[0], dir, ...args.slice(1)], { encoding: "utf8" });

const web = new spike.WebPeer("b", "d2");

writeFileSync(file("kp"), web.keyPackage());
run("invite", file("kp"), file("welcome"));
web.join(readFileSync(file("welcome")));
console.log("browser joined the native group");
const plaintext = spike.WebPeer.storeFileIsPlaintext();
console.log("browser store file is plaintext:", plaintext);
assert.equal(plaintext, expect !== "encrypted");
const wrongKey = spike.WebPeer.wrongKeyFails();
console.log("browser store refuses a wrong key:", wrongKey);
assert.equal(wrongKey, expect === "encrypted");

writeFileSync(file("m1"), web.send("w1", Date.now(), "Halló úr vafranum"));
const got = run("receive", file("m1")).trim();
assert.equal(got, "b/d2\tHalló úr vafranum");
console.log("native read:", got);

run("send", "Halló úr Rust", file("m2"));
const [sender, text] = web.receive(readFileSync(file("m2")));
assert.equal(sender, "a/d1");
assert.equal(text, "Halló úr Rust");
console.log("browser read:", `${sender}\t${text}`);
console.log("interop: ok");

// What spjall-client needs from std, last: a trap leaves the module unusable.
console.log("std::fs::write:", spike.probeFsWrite());
for (const probe of ["probeSystemTime", "probeInstant"]) {
  try {
    spike[probe]();
    console.log(`${probe}: ok`);
  } catch (error) {
    console.log(`${probe}: ${String(error).split("\n")[0]}`);
  }
}
