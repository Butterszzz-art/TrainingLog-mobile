package com.pocketcoach.speechtotext

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.Locale

/**
 * Speech to text for logging food by voice. JS side: src/js/speech-input.js.
 *
 *   available()          → { available }
 *   requestPermission()  → { granted }   (RECORD_AUDIO)
 *   start({ language })  → { text }      resolves when listening ends: the
 *                                          user tapped stop, went quiet, or
 *                                          hit the 60 s limit
 *   stop()                                 finish now (start() then resolves)
 *   "partial" event      → { text }      the words so far, while listening
 *
 * Uses the phone's own speech service (Google on most phones) through
 * android.speech.SpeechRecognizer, which must be used on the main thread.
 */
@CapacitorPlugin(
    name = "SpeechToText",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])]
)
class SpeechToTextPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var pending: PluginCall? = null
    private var lastText = ""
    private val limit = Runnable { recognizer?.stopListening() }

    @PluginMethod
    fun available(call: PluginCall) {
        val out = JSObject()
        out.put("available", SpeechRecognizer.isRecognitionAvailable(context))
        call.resolve(out)
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve(granted(true))
        } else {
            requestPermissionForAlias("microphone", call, "micPermissionCallback")
        }
    }

    @PermissionCallback
    private fun micPermissionCallback(call: PluginCall) {
        call.resolve(granted(getPermissionState("microphone") == PermissionState.GRANTED))
    }

    private fun granted(ok: Boolean): JSObject {
        val out = JSObject()
        out.put("granted", ok)
        return out
    }

    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission not granted", "permission")
            return
        }
        main.post { begin(call) }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            recognizer?.stopListening()
            call.resolve()
        }
    }

    private fun begin(call: PluginCall) {
        if (pending != null) {
            call.reject("Already listening", "busy")
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            call.reject("Speech recognition is not available on this phone", "unavailable")
            return
        }
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        pending = call
        lastText = ""
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) {
                val t = firstResult(partialResults)
                if (!t.isNullOrBlank()) {
                    lastText = t
                    val out = JSObject()
                    out.put("text", t)
                    notifyListeners("partial", out)
                }
            }
            override fun onResults(results: Bundle?) {
                finish(firstResult(results) ?: lastText, null)
            }
            override fun onError(error: Int) {
                finish(lastText, error)
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val language = call.getString("language") ?: Locale.getDefault().toLanguageTag()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // A food list has pauses ("two eggs... and toast"): wait a bit
            // longer before deciding the user is done.
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
        }
        recognizer = r
        r.startListening(intent)
        main.postDelayed(limit, 60_000L)
    }

    private fun firstResult(b: Bundle?): String? =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

    private fun finish(text: String, error: Int?) {
        val call = pending ?: return
        pending = null
        main.removeCallbacks(limit)
        recognizer?.destroy()
        recognizer = null
        val t = text.trim()
        val heardNothing = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        if (t.isNotEmpty() || error == null || heardNothing) {
            val out = JSObject()
            out.put("text", t)
            call.resolve(out)
        } else {
            call.reject("Speech recognition failed ($error)", "failed")
        }
    }

    override fun handleOnDestroy() {
        main.removeCallbacks(limit)
        recognizer?.destroy()
        recognizer = null
        super.handleOnDestroy()
    }
}
