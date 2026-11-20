import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { focusTrapTarget } from "./dialog-focus.js";

const controls = [{ id: "close" }, { id: "change-loop" }, { id: "done" }];

NodeTest.test("Tab from the last dialog control wraps to the first", () => {
  NodeAssert.equal(focusTrapTarget(controls, controls.at(-1), false), controls[0]);
});

NodeTest.test("Shift+Tab from the first dialog control wraps to the last", () => {
  NodeAssert.equal(focusTrapTarget(controls, controls[0], true), controls.at(-1));
});

NodeTest.test("focus outside the dialog returns to its nearest edge", () => {
  NodeAssert.equal(focusTrapTarget(controls, { id: "outside" }, false), controls[0]);
  NodeAssert.equal(focusTrapTarget(controls, { id: "outside" }, true), controls.at(-1));
});

NodeTest.test("Tab between dialog controls keeps the browser's natural focus order", () => {
  NodeAssert.equal(focusTrapTarget(controls, controls[1], false), null);
  NodeAssert.equal(focusTrapTarget(controls, controls[1], true), null);
});
