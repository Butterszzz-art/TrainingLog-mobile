import Foundation
import Capacitor
import Speech
import AVFoundation

/// Speech to text for logging food by voice. JS side: src/js/speech-input.js.
///
///   available()          → { available }
///   requestPermission()  → { granted }   (speech recognition + microphone)
///   start({ language })  → { text }      resolves when listening ends: the
///                                          user tapped stop, went quiet, or
///                                          hit the 60 s limit
///   stop()                                 finish now (start() then resolves)
///   "partial" event      → { text }      the words so far, while listening
///
/// Needs NSSpeechRecognitionUsageDescription and NSMicrophoneUsageDescription
/// in the app's Info.plist (codemagic.yaml adds them).
@objc(SpeechToTextPlugin)
public class SpeechToTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechToTextPlugin"
    public let jsName = "SpeechToText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var pending: CAPPluginCall?
    private var lastText = ""
    private var silenceTimer: Timer?
    private var limitTimer: Timer?

    private static let silenceSeconds: TimeInterval = 2.5
    private static let maxSeconds: TimeInterval = 60

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": SFSpeechRecognizer()?.isAvailable ?? false])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.resolve(["granted": false])
                return
            }
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { ok in call.resolve(["granted": ok]) }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { ok in call.resolve(["granted": ok]) }
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.begin(call) }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endAudio()
            // The recogniser sends its final result shortly after the audio
            // ends; finish anyway if it doesn't.
            self.restartSilenceTimer(after: 1.5)
            call.resolve()
        }
    }

    // MARK: - Listening (main thread)

    private func begin(_ call: CAPPluginCall) {
        if pending != nil {
            call.reject("Already listening", "busy")
            return
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.reject("Speech recognition permission not granted", "permission")
            return
        }
        let language = call.getString("language")
        let recognizer = language.flatMap { SFSpeechRecognizer(locale: Locale(identifier: $0)) } ?? SFSpeechRecognizer()
        guard let recognizer = recognizer, recognizer.isAvailable else {
            call.reject("Speech recognition is not available right now", "unavailable")
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("Could not use the microphone", "audio", error)
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if #available(iOS 16.0, *) { req.addsPunctuation = true }

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 && format.channelCount > 0 else {
            call.reject("No microphone input", "audio")
            return
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            input.removeTap(onBus: 0)
            call.reject("Could not start the microphone", "audio", error)
            return
        }

        request = req
        pending = call
        lastText = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.pending != nil else { return }
                if let result = result {
                    self.lastText = result.bestTranscription.formattedString
                    self.notifyListeners("partial", data: ["text": self.lastText])
                    if result.isFinal {
                        self.finish(nil)
                        return
                    }
                    self.restartSilenceTimer(after: SpeechToTextPlugin.silenceSeconds)
                }
                if let error = error { self.finish(error) }
            }
        }
        // Nothing said at all: give up after a while like the silence rule.
        restartSilenceTimer(after: 6)
        limitTimer = Timer.scheduledTimer(withTimeInterval: SpeechToTextPlugin.maxSeconds, repeats: false) { [weak self] _ in
            self?.endAudio()
            self?.restartSilenceTimer(after: 1.5)
        }
    }

    private func restartSilenceTimer(after seconds: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.finish(nil)
        }
    }

    private func endAudio() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
    }

    private func finish(_ error: Error?) {
        guard let call = pending else { return }
        pending = nil
        silenceTimer?.invalidate()
        silenceTimer = nil
        limitTimer?.invalidate()
        limitTimer = nil
        endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        let text = lastText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty || error == nil {
            call.resolve(["text": text])
        } else {
            // "No speech detected" and the like: nothing was heard.
            let nsError = error! as NSError
            if nsError.domain == "kAFAssistantErrorDomain" && [1110, 216, 203].contains(nsError.code) {
                call.resolve(["text": ""])
            } else {
                call.reject("Speech recognition failed", "failed", error)
            }
        }
    }

    deinit {
        silenceTimer?.invalidate()
        limitTimer?.invalidate()
    }
}
