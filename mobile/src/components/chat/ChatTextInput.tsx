// Chat text box that also accepts GIFs, stickers and images inserted from the Android keyboard (Gboard "GIF" tab,
// Samsung keyboard stickers, …) and images pasted from the clipboard. React Native's own TextInput tells Android it
// accepts text only, so keyboards refuse to insert GIFs into it; PasteInput declares image content support.
// Falls back to the normal TextInput if the native component is missing (tests, Expo Go, old builds).
import React, { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

export interface KeyboardMedia {
  uri: string;
  type: string;
}

type Props = TextInputProps & { onKeyboardMedia?: (media: KeyboardMedia) => void; onKeyboardMediaError?: (message: string) => void };

let PasteInput: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PasteInput = require("@mattermost/react-native-paste-input").default;
} catch {
  PasteInput = null;
}

/** Only real images become chat media; anything else a keyboard offers (video, documents) is ignored. */
export function pickKeyboardImage(files: Array<{ uri?: string; type?: string }> | null | undefined): KeyboardMedia | null {
  for (const f of files ?? []) {
    const type = (f?.type ?? "").toLowerCase();
    if (f?.uri && /^image\/(gif|png|jpe?g|webp)$/.test(type)) return { uri: f.uri, type };
  }
  return null;
}

export const ChatTextInput = forwardRef<any, Props>(function ChatTextInput(
  { onKeyboardMedia, onKeyboardMediaError, ...props },
  ref,
) {
  if (!PasteInput) return <TextInput ref={ref} {...props} />;
  return (
    <PasteInput
      ref={ref}
      {...props}
      disableCopyPaste={false}
      onPaste={(error: string | null | undefined, files: Array<{ uri?: string; type?: string }>) => {
        if (error) {
          onKeyboardMediaError?.("That item couldn't be added. Try another GIF or image.");
          return;
        }
        const media = pickKeyboardImage(files);
        if (media) onKeyboardMedia?.(media);
        else if (files?.length) onKeyboardMediaError?.("Only GIFs and images can be sent here.");
      }}
    />
  );
});
