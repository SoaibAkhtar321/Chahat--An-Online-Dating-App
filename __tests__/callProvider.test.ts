jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(false),
  supabase: {},
}));

import { callProvider } from "../mobile/src/services/calls";
import type { VideoCall } from "../mobile/src/services/calls";

describe("provider-neutral call foundation", () => {
  it("does not claim a live media provider is configured", () => {
    expect(callProvider.configured).toBe(false);
  });

  it("fails explicitly rather than simulating a successful live call", async () => {
    const call: VideoCall = {
      id: "call-1",
      match_id: "match-1",
      caller_id: "user-1",
      recipient_id: "user-2",
      call_type: "video",
      status: "accepted",
      created_at: "2026-10-15T00:00:00Z",
      expires_at: "2026-10-15T00:01:00Z",
      free_seconds_remaining: 60,
    };
    await expect(callProvider.join(call)).rejects.toThrow("No live media call can be started");
  });
});
