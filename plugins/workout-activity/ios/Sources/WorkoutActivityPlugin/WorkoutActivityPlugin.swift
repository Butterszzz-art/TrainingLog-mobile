import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Starts, updates and ends the workout Live Activity, and feeds the
/// Home Screen "Today" widget.
/// JS side: src/js/live-activity.js and src/js/home-widget.js.
/// Widget UI: native/ios/PocketCoachLiveActivity.
///
/// Needs NSSupportsLiveActivities in the app's Info.plist (codemagic.yaml
/// adds it) and iOS 16.2+; on older systems every call is a no-op.
@objc(WorkoutActivityPlugin)
public class WorkoutActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WorkoutActivityPlugin"
    public let jsName = "WorkoutActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWidget", returnType: CAPPluginReturnPromise)
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    /// Shows the given state, starting the Live Activity if none is running.
    /// Options mirror WorkoutActivityAttributes.ContentState; dates are epoch ms.
    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["active": false])
            return
        }
        guard let startedAtMs = call.getDouble("startedAt") else {
            call.reject("startedAt is required")
            return
        }
        let state = WorkoutActivityAttributes.ContentState(
            title: call.getString("title") ?? "Workout",
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
            exercise: call.getString("exercise"),
            setsDone: call.getInt("setsDone") ?? 0,
            exercisesDone: call.getInt("exercisesDone") ?? 0,
            restEndsAt: call.getDouble("restEndsAt").map { Date(timeIntervalSince1970: $0 / 1000) },
            restTotalSeconds: call.getInt("restTotalSeconds"),
            restPausedRemaining: call.getInt("restPausedRemaining")
        )
        // Marked stale when the rest runs out, so the widget can switch to
        // "Rest over" even while the app is suspended.
        let content = ActivityContent(state: state, staleDate: state.restRange?.upperBound)

        Task {
            let running = Activity<WorkoutActivityAttributes>.activities
            if let current = running.first {
                for extra in running.dropFirst() {
                    await extra.end(nil, dismissalPolicy: .immediate)
                }
                await current.update(content)
                call.resolve(["active": true])
                return
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["active": false])
                return
            }
            do {
                _ = try Activity.request(attributes: WorkoutActivityAttributes(), content: content, pushType: nil)
                call.resolve(["active": true])
            } catch {
                call.reject("Could not start the Live Activity: \(error.localizedDescription)")
            }
        }
    }

    /// Ends every workout Live Activity and removes it from the Lock Screen.
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<WorkoutActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    /// Saves the Today widget's snapshot (src/js/home-widget.js) in the App
    /// Group the widget reads, and asks iOS to redraw it. Options without a
    /// "date" (signed out) clear it.
    @objc func updateWidget(_ call: CAPPluginCall) {
        guard let defaults = TodayWidgetStore.defaults else {
            call.reject("App Group \(TodayWidgetStore.groupId ?? "(none)") is not available")
            return
        }
        if call.getString("date") == nil {
            defaults.removeObject(forKey: TodayWidgetStore.key)
        } else {
            let options: Any = call.options ?? [:]
            // JSONSerialization raises (and crashes) rather than throwing on bad input.
            guard JSONSerialization.isValidJSONObject(options) else {
                call.reject("The widget snapshot isn't valid JSON")
                return
            }
            do {
                let data = try JSONSerialization.data(withJSONObject: options)
                defaults.set(data, forKey: TodayWidgetStore.key)
            } catch {
                call.reject("Could not save the widget snapshot: \(error.localizedDescription)")
                return
            }
        }
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: TodayWidgetStore.kind)
        }
        #endif
        call.resolve()
    }
}
