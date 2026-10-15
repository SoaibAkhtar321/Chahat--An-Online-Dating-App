import { useEffect, useState } from "react";
import { CallController, INITIAL_CALL_STATE, type CallControllerState } from "../services/callController";
import { getCallMediaProvider, isCallingAvailable } from "../services/callMedia";
import { requestCallToken } from "../services/callToken";

export function useCallController(): {
  controller: CallController | null;
  state: CallControllerState;
} {
  const [controller, setController] = useState<CallController | null>(null);
  const [state, setState] = useState<CallControllerState>(INITIAL_CALL_STATE);

  useEffect(() => {
    const created = new CallController({
      provider: getCallMediaProvider(),
      requestToken: (callId) => requestCallToken(callId),
      isEnabled: () => isCallingAvailable(),
    });
    const unsubscribe = created.subscribe(setState);
    setController(created);
    return () => {
      unsubscribe();
      void created.dispose();
    };
  }, []);

  return { controller, state };
}
