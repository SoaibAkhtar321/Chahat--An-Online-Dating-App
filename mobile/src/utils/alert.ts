import { Alert as RNAlert, Platform } from "react-native";
import type { AlertButton } from "react-native";

/**
 * Drop-in replacement for React Native's Alert.
 * react-native-web's Alert.alert is a no-op, so on web messages (including errors)
 * would silently disappear. On web we use the browser dialogs instead.
 */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    if (Platform.OS !== "web") {
      RNAlert.alert(title, message, buttons);
      return;
    }

    const text = [title, message].filter(Boolean).join("\n\n");
    const list = buttons ?? [];

    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }

    const cancel = list.find((b) => b.style === "cancel");
    const actions = list.filter((b) => b !== cancel);
    if (window.confirm(text)) {
      (actions.find((b) => b.style === "destructive") ?? actions[0])?.onPress?.();
    } else {
      cancel?.onPress?.();
    }
  },
};
