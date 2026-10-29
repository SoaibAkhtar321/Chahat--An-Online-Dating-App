package expo.modules.callstate

import android.content.Context
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Is the phone already in a call? Android puts the audio system in MODE_IN_CALL during a normal phone call and in
// MODE_IN_COMMUNICATION during a VoIP call (WhatsApp, Meet, Telegram, ...), and MODE_RINGTONE while one rings.
// Reading the mode needs no permission (unlike TelephonyManager.getCallState, which needs READ_PHONE_STATE).
class CallStateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ChahatCallState")

    Function("getAudioMode") {
      val context: Context? = appContext.reactContext
      val audio = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.mode ?: AudioManager.MODE_NORMAL
    }
  }
}
