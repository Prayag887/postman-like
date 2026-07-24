import { describe, expect, it } from "vitest";
import { bodyText, displayState, duration } from "./App";
import type { HttpTransaction } from "./types";
const transaction = { response: undefined, timing: {request_started_ms:100}, comparison: undefined } as HttpTransaction;
describe("traffic presentation", () => {
  it("shows pending rows immediately", () => expect(displayState(transaction)).toBe("Pending"));
  it("calculates completed duration", () => expect(duration({...transaction,timing:{request_started_ms:100,response_complete_ms:538}})).toBe(438));
  it("decodes inline bodies", () => expect(bodyText({storage:"inline",bytes:[123,125]})).toBe("{}"));
  it("marks comparison changes", () => expect(displayState({...transaction,response:{status:200},comparison:{
    compatibility:"exact",differences:[{kind:"value_changed",severity:"warning",ignored:false,explanation:"changed"}]}} as HttpTransaction)).toBe("Changed"));
});
